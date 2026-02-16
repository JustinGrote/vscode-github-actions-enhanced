import * as vscode from "vscode";

import { canReachGitHubAPI } from "../api/canReachGitHubAPI";
import { getCurrentBranch, getGitHubContext, GitHubRepoContext } from "../git/repository";
import { CurrentBranchRepoNode } from "./current-branch/currentBranchRepoNode";

import {
    CollectionImpl
} from "@tanstack/db";
import { match, P } from "ts-pattern";
import {
    logDebug, logTrace, logWarn
} from "../log";
import {
    WorkflowRun
} from "../model";
import { NoRunForBranchNode } from "./current-branch/noRunForBranchNode";
import {
    createGithubCollection,
    GithubCollection
} from "./githubCollection";
import { AttemptNode } from "./shared/attemptNode";
import { GitHubAPIUnreachableNode } from "./shared/gitHubApiUnreachableNode";
import { NoWorkflowJobsNode } from "./shared/noWorkflowJobsNode";
import { PreviousAttemptsNode } from "./shared/previousAttemptsNode";
import { WorkflowJobNode } from "./shared/workflowJobNode";
import { WorkflowRunNode } from "./shared/workflowRunNode";
import {
    WorkflowRunTreeDataProvider
} from "./workflowRunTreeDataProvider";
import { WorkflowStepNode } from "./workflows/workflowStepNode";
import { getWorkflowNodes } from "./workflows/workflowsRepoNode";

type CurrentBranchTreeNode =
  | CurrentBranchRepoNode
  | WorkflowRunNode
  | PreviousAttemptsNode
  | AttemptNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | NoRunForBranchNode
  | GitHubAPIUnreachableNode;

const REFRESH_TREE_ROOT = null;

export class CurrentBranchTreeProvider
  extends WorkflowRunTreeDataProvider
  implements vscode.TreeDataProvider<CurrentBranchTreeNode>
{
  protected _onDidChangeTreeData = new vscode.EventEmitter<CurrentBranchTreeNode | CurrentBranchTreeNode[] | typeof REFRESH_TREE_ROOT>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Node updated: ${node.id} ${node.label}`);
    this._onDidChangeTreeData.fire(node);
  }

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

    if (!element) {
      const gitHubContext = await getGitHubContext();
      if (!gitHubContext) {
        return [new GitHubAPIUnreachableNode()];
      }

      if (gitHubContext.repos.length === 1) {
        const repoContext = gitHubContext.repos[0];
        const currentBranch = getCurrentBranch(repoContext.repositoryState);
        if (!currentBranch) {
          logWarn(`Could not find current branch for ${repoContext.name}`);
          return [];
        }

        return (await this.getRunNodes(repoContext, currentBranch)) || [];
      }

      if (gitHubContext.repos.length > 1) {
        return gitHubContext.repos
          .map((repoContext): CurrentBranchRepoNode | undefined => {
            const currentBranch = getCurrentBranch(repoContext.repositoryState);
            if (!currentBranch) {
              logWarn(`Could not find current branch for ${repoContext.name}`);
              return undefined;
            }
            return new CurrentBranchRepoNode(repoContext, currentBranch);
          })
          .filter(x => x !== undefined) as CurrentBranchRepoNode[];
      }
    }

    const result = match(element)
      .with(P.instanceOf(CurrentBranchRepoNode),
        e => this.getRunNodes(e.gitHubRepoContext, e.currentBranchName)
      )
      .with(P.instanceOf(PreviousAttemptsNode),
        e => e.getAttempts()
      )
      .with(P.instanceOf(AttemptNode),
        e => e.getJobs()
      )
      .with(P.instanceOf(WorkflowJobNode),
        e => e.getSteps()
      )
      .with(P.instanceOf(WorkflowRunNode),
        e => e.getJobs()
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
          per_page: 100
        },
        (response) => response.data.workflow_runs,
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        "node_id"
      );
    }

    const runs = await this.workflowRunCollection.toArrayWhenReady();

    // Subscribe for future changes after initial query
    if (!this.changeFeed) {
      this.changeFeed = this.workflowRunCollection.subscribeChanges((changes) => {
        const nodesToRefresh = changes.map(change => {
          logTrace(`🚨 WorkflowRuns change detected: ${change.type} ${change.value.node_id} ${change.value.name} #${change.value.run_number}`);
          return this.toWorkflowRunNode(change.value, gitHubRepoContext);
        });
        this._onDidChangeTreeData.fire(nodesToRefresh)
      })
      logDebug(`Registered listener for run updates for repo ${gitHubRepoContext.name}`);
    }

    const currentBranchRuns = runs.filter(run => run.head_branch === currentBranchName);

    if (currentBranchRuns.length === 0) {
      return [new NoRunForBranchNode()];
    }

    return currentBranchRuns.map(run => this.toWorkflowRunNode(run, gitHubRepoContext));
  }

  private toWorkflowRunNode(
    run: WorkflowRun,
    gitHubRepoContext: GitHubRepoContext
  ) {
      const existingNode = this.workflowRunNodes.get(run.node_id);
      if (existingNode) {
        logTrace(`Run ${run.node_id} already exists in tree, reusing existing node and updating its data`);
        existingNode.updateRun(run);
        return existingNode;
      }

      logDebug(`➕ Adding run ${run.node_id} ${run.name} #${run.run_number} to tree`);
      const workflowRunNode = new WorkflowRunNode(gitHubRepoContext, run);
      this.workflowRunNodes.set(run.node_id, workflowRunNode);
      return workflowRunNode;
  }
}

