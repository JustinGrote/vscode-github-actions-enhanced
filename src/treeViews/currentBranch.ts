import * as vscode from "vscode";

import { canReachGitHubAPI } from "../api/canReachGitHubAPI";
import { getRunsPrefetchCount } from "../configuration/configuration";
import { getCurrentBranch, getGitHubContext, GitHubRepoContext } from "../git/repository";
import { CurrentBranchRepoNode } from "./current-branch/currentBranchRepoNode";

import {
    CollectionImpl
} from "@tanstack/db";
import { match, P } from "ts-pattern";
import {
    logDebug, logError, logTrace, logWarn
} from "../log";
import {
    WorkflowRun
} from "../model";
import { NoRunForBranchNode } from "./current-branch/noRunForBranchNode";
import {
    createGithubCollection,
    GithubCollection
} from "./githubCollection";
import { WorkflowRunAttemptNode } from "./shared/workflowRunAttemptNode";
import { GitHubAPIUnreachableNode } from "./shared/gitHubApiUnreachableNode";
import { NoWorkflowJobsNode } from "./shared/noWorkflowJobsNode";
import { PreviousAttemptsNode } from "./shared/previousAttemptsNode";
import { WorkflowJobNode } from "./shared/workflowJobNode";
import { WorkflowRunNode } from "./shared/workflowRunNode";
import {
    WorkflowRunTreeDataProvider
} from "./workflowRunTreeDataProvider";
import { WorkflowStepNode } from "./workflows/workflowStepNode";

type CurrentBranchTreeNode =
  | CurrentBranchRepoNode
  | WorkflowRunNode
  | PreviousAttemptsNode
  | WorkflowRunAttemptNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | NoRunForBranchNode
  | GitHubAPIUnreachableNode;

/** A "magic number" to signal to vscode to refresh the root of the tree */
const REFRESH_TREE_ROOT = null;

export class CurrentBranchTreeProvider
  extends WorkflowRunTreeDataProvider
  implements vscode.TreeDataProvider<CurrentBranchTreeNode>
{
  protected _onDidChangeTreeData = new vscode.EventEmitter<
    CurrentBranchTreeNode
    | CurrentBranchTreeNode[]
    | typeof REFRESH_TREE_ROOT
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Node updated: ${node.id} ${node.label}`);
    this._onDidChangeTreeData.fire(node);
  }

  private onDidChangeTreeDataTrace = this.onDidChangeTreeData((e) => {
    if (e === REFRESH_TREE_ROOT) {
      logTrace(`👉 VSCode informed to refresh full tree`);
    } else if (Array.isArray(e)) {
      logTrace(`👉 VSCode informed to refresh tree nodes: ${e.map(n => n.id).join(", ")}`);
    }
    else {
      logTrace(`👉 VSCode informed to refresh tree node ${e.id} ${e.label}`);
    }
  });

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      // This will tell vscode to subsequently call getChildren(undefined) for the root node
      this._onDidChangeTreeData.fire(REFRESH_TREE_ROOT);
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API");
    }
  }

  getTreeItem(element: CurrentBranchTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    logTrace(`🧑‍💻 vscode called getTreeItem for ${element.label} [${element.id}] `);
    return element;
  }

  async getChildren(element?: CurrentBranchTreeNode | undefined, clearCache?: boolean): Promise<CurrentBranchTreeNode[]> {
    const elementDescription = element ? `${element.constructor.name}: ${element.id} ${element.label}` : "🌲 Root"
    logTrace(`🧑‍💻 vscode called getChildren for ${elementDescription}`);

    const result = await match(element)
      .with(P.nullish, async () => {
        const gitHubContext = await getGitHubContext();
        if (!gitHubContext) {
          return [new GitHubAPIUnreachableNode()];
        }

        const repoNodes = gitHubContext.repos
          .map((repoContext): CurrentBranchRepoNode | undefined => {
            const currentBranch = getCurrentBranch(repoContext.repositoryState);
            if (!currentBranch) {
              logWarn(`Could not find current branch for ${repoContext.name}`);
              return undefined;
            }
            return new CurrentBranchRepoNode(repoContext, currentBranch);
          })
          .filter(x => x !== undefined) as CurrentBranchRepoNode[];

        if (gitHubContext.repos.length === 0) {
          logWarn("No GitHub repositories found in context");
          return [];
        }
        if (gitHubContext.repos.length === 1) {
          logDebug("Only one GitHub repository found in context, expanding it by default to save a click.");
          const singleRepoNode = repoNodes[0];
          return await this.getRunNodes(singleRepoNode.gitHubRepoContext, singleRepoNode.currentBranchName)
        }
      })
      .with(P.instanceOf(CurrentBranchRepoNode),
        async e => {
          return await this.getRunNodes(e.gitHubRepoContext, e.currentBranchName)
        }
      )
      .with(P.instanceOf(WorkflowRunNode),
        e => e.getJobNodes()
      )
      .with(P.instanceOf(WorkflowRunAttemptNode),
        e => e.getJobNodes()
      )
      .with(P.instanceOf(WorkflowJobNode),
        e => e.getSteps()
      )
      .with(P.instanceOf(PreviousAttemptsNode),
        e => e.getAttempts()
      )
      .otherwise(
        e => {
          logWarn(`Unknown class seen during getChildren: ${e?.constructor?.name}. Has it been implemented yet?`);
          return Promise.resolve([]);
        }
      );

    return result;
  }


  private workflowRunCollection: GithubCollection<WorkflowRun, {owner: string, repo: string}> | undefined;
  private changeFeed: ReturnType<CollectionImpl<WorkflowRun>["subscribeChanges"]> | undefined;

  /** Cache of workflow run nodes by their ID. When the store notifies us of an update, we can use this cache to quickly find the corresponding nodes and notify vscode they have changed */
  private workflowRunNodes: Map<string, WorkflowRunNode> = new Map();
  private async getRunNodes(
    gitHubRepoContext: GitHubRepoContext,
    currentBranchName: string
  ): Promise<WorkflowRunNode[] | NoRunForBranchNode[]> {

    logDebug(`Getting current branch (${currentBranchName}) runs in repo ${gitHubRepoContext.name}`);

    const client = gitHubRepoContext.client;
    const queryKey = ['workflowRuns']
    if (!this.workflowRunCollection) {
      logDebug(`Creating workflow run collection for repo ${gitHubRepoContext.name}`);
      client.actions.listRepoWorkflows
      this.workflowRunCollection = createGithubCollection(
        queryKey,
        client,
        client.actions.listWorkflowRunsForRepo,
        {
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          branch: currentBranchName,
          per_page: 30
        },
        (response) => response.data.workflow_runs,
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        "id"
      );
    }

    const runs = await this.workflowRunCollection.toArrayWhenReady();

    // Subscribe for future changes after initial query
    if (!this.changeFeed) {
      this.changeFeed = this.workflowRunCollection.subscribeChanges((changes) => {
        // HACK: If a deletion occurs, VSCode needs us to supply its parent so it can do a getChildren on it. Since deletions are rare, we just tell it to refresh the entire tree for simplicity.
        let rootRefreshNeeded = false;

        const nodesToRefresh = changes.map(change => {
          logTrace(`🚨 WorkflowRuns change detected: ${change.type} ${change.value.id} ${change.value.name} #${change.value.run_number}`);
          return match(change)
            .with({type: "update"}, () => {
              logDebug(`✏️ Run ${change.value.id} was updated`);
              return this.toWorkflowRunNode(change.value, gitHubRepoContext);
            })
            .with({type: "insert"}, () => {
              logDebug(`➕ Run ${change.value.id} was inserted`);
              rootRefreshNeeded = true;
              return this.toWorkflowRunNode(change.value, gitHubRepoContext);
            })
            .with({type: "delete"}, () => {
              logDebug(`🗑️ Run ${change.value.id} was deleted`);
              this.workflowRunNodes.delete(change.value.id.toString());
              rootRefreshNeeded = true;
            })
            .exhaustive()
        }).filter(node => node !== undefined);

        this._onDidChangeTreeData.fire(rootRefreshNeeded ? REFRESH_TREE_ROOT : nodesToRefresh);
      })

      logDebug(`👁️ Watcher for WorkflowRuns created for repo ${gitHubRepoContext.name}`);
    }

    const currentBranchRuns = runs.filter(run => run.head_branch === currentBranchName);

    if (currentBranchRuns.length === 0) {
      return [new NoRunForBranchNode()];
    }

    const runNodes = currentBranchRuns.map(run => this.toWorkflowRunNode(run, gitHubRepoContext));

    // Perform opportunistic prefetching
    const prefetchCount = getRunsPrefetchCount();
    if (prefetchCount > 0) {
      runNodes.slice(0, prefetchCount)
        .map(node => node.getJobNodes()
        .catch(err => logError(err, `Error pre-caching jobs for run ${node.id} ${node.label}`))
      );
    }

    return runNodes
  }

  private toWorkflowRunNode(
    run: WorkflowRun,
    gitHubRepoContext: GitHubRepoContext
  ) {
      const existingNode = this.workflowRunNodes.get(run.id.toString());
      if (existingNode) {
        logTrace(`🖊️ Run ${run.id} already exists in tree, reusing existing node and updating its data`);
        existingNode.updateRun(run);
        return existingNode;
      }

      logTrace(`➕ Adding run ${run.id} ${run.name} #${run.run_number} to tree`);
      const workflowRunNode = new WorkflowRunNode(gitHubRepoContext, run);
      this.workflowRunNodes.set(run.id.toString(), workflowRunNode);
      return workflowRunNode;
  }
}

