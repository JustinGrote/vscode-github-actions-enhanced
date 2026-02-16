import * as vscode from "vscode";

import {canReachGitHubAPI} from "../api/canReachGitHubAPI";
import {getCurrentBranch, getGitHubContext, GitHubRepoContext} from "../git/repository";
import {CurrentBranchRepoNode} from "./current-branch/currentBranchRepoNode";

import {NoRunForBranchNode} from "./current-branch/noRunForBranchNode";
import {log,
logDebug, logTrace, logWarn} from "../log";
import {AttemptNode} from "./shared/attemptNode";
import {GitHubAPIUnreachableNode} from "./shared/gitHubApiUnreachableNode";
import {NoWorkflowJobsNode} from "./shared/noWorkflowJobsNode";
import {PreviousAttemptsNode} from "./shared/previousAttemptsNode";
import {WorkflowJobNode} from "./shared/workflowJobNode";
import {WorkflowRunNode} from "./shared/workflowRunNode";
import {getOrCreateRunStore,
WorkflowRunTreeDataProvider} from "./workflowRunTreeDataProvider";
import {WorkflowStepNode} from "./workflows/workflowStepNode";
import { match,P } from "ts-pattern";
import { WorkflowJob,
WorkflowRun } from "../model";
import { createGithubCollection,
defaultQueryClient,
GithubCollection } from "./githubCollection";
import { Collection,
CollectionImpl } from "@tanstack/db";

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
    const elementDescription = element ? `${element.constructor.name}: ${element.id} ${element.label}` : "Root Tree Node"
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
  private subscription: ReturnType<CollectionImpl<WorkflowRun>["subscribeChanges"]> | undefined;
  private refresher: NodeJS.Timeout | undefined;

  /** Cache of workflow run nodes by their ID. When the store notifies us of an update, we can use this cache to quickly find the corresponding nodes and notify vscode they have changed */
  private workflowRunNodes: Map<number, WorkflowRunNode> = new Map();
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

    // Start timer to invalidate the query
    // if (!this.refresher) {
    //   this.refresher = setInterval(() => {
    //     defaultQueryClient.invalidateQueries({queryKey}, { cancelRefetch: false, throwOnError: true });
    //   }, 1000);
    // }

    // Subscribe for future changes after initial query
    this.subscription = this.workflowRunCollection.subscribeChanges((changes) => {
      const runIds = changes.map(run => run.value.id);
      logTrace(`Received run update event for runs: ${runIds.join(", ")}`);

      let nodesToRefresh: WorkflowRunNode[] | typeof REFRESH_TREE_ROOT = runIds.map(id => this.workflowRunNodes.get(id)).filter(node => !!node);
      logTrace(`🚀 Notifying vscode of changes to runs: ${nodesToRefresh.map(r => r.id).join(", ")}`);
      if (nodesToRefresh.length === 0) {
        logTrace(`Notified of new runs that don't match any existing nodes, so we need to do a tree refresh. Setting to REFRESH_TREE_ROOT, as vscode doesn't recognize an empty array as a trigger to refresh the tree.`);
        nodesToRefresh = REFRESH_TREE_ROOT;
      }
      this._onDidChangeTreeData.fire(nodesToRefresh)
    })
    logDebug(`Registered listener for run updates for repo ${gitHubRepoContext.name}`);
    const currentBranchRuns = runs.filter(run => run.head_branch === currentBranchName);

    if (currentBranchRuns.length === 0) {
      return [new NoRunForBranchNode()];
    }

    return currentBranchRuns.map(run => {
      logTrace(`Adding run ${run.id} ${run.name} #${run.run_number} to tree with branch ${currentBranchName} and repo ${gitHubRepoContext.name}`)
      this.workflowRunNodes.set(run.id, new WorkflowRunNode(gitHubRepoContext, run));
      return this.workflowRunNodes.get(run.id)!;
    });
  }
}