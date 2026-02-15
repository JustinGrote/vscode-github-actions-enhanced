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

export class CurrentBranchTreeProvider
  extends WorkflowRunTreeDataProvider
  implements vscode.TreeDataProvider<CurrentBranchTreeNode>
{
  protected _onDidChangeTreeData = new vscode.EventEmitter<CurrentBranchTreeNode | CurrentBranchTreeNode[] | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Node updated: ${node.id} ${node.label}`);
    this._onDidChangeTreeData.fire(node);
  }

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      // This will tell vscode to subsequently call getChildren(undefined) for the root node
      this._onDidChangeTreeData.fire(null);
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API");
    }
  }

  getTreeItem(element: CurrentBranchTreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    logTrace(`🧑‍💻 vscode called getTreeItem for ${element.constructor.name}: ${element.id} ${element.label}`);
    return element;
  }

  async getChildren(element?: CurrentBranchTreeNode | undefined, clearCache?: boolean): Promise<CurrentBranchTreeNode[]> {
    logTrace(`🧑‍💻 vscode called getChildren for ${element?.constructor.name}: ${element?.id} ${element?.label} `);
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

  private listener: boolean = false;
  private async getRunNodes(
    gitHubRepoContext: GitHubRepoContext,
    currentBranchName: string
  ): Promise<WorkflowRunNode[] | NoRunForBranchNode[]> {

    logDebug(`Getting current branch (${currentBranchName}) runs in repo ${gitHubRepoContext.name}`);

    const runStore = getOrCreateRunStore(gitHubRepoContext);

    const runs = await runStore.list();
    if (!this.listener) {
      logDebug(`Registered listener for run updates for repo ${gitHubRepoContext.name}`);
      const listener = runStore.onDidUpdate(async runIds => {
        logDebug(`Received run update event for runs: ${runIds.join(", ")}`);
        const updatedRuns = await Promise.all(runIds
          .map(async id => await runStore.get(id))
        );
        const filteredRunNodes = updatedRuns
          .filter(run => run !== undefined)
          .map(run => new WorkflowRunNode(gitHubRepoContext, run!))
        logDebug(`Triggering update event for runs: ${filteredRunNodes.map(n => n.id).join(", ")}`);
        this._onDidChangeTreeData.fire(filteredRunNodes);
      })
      this.listener = true;
    }

    const currentBranchRuns = runs.filter(run => run.head_branch === currentBranchName);

    if (currentBranchRuns.length === 0) {
      return [new NoRunForBranchNode()];
    }
    return currentBranchRuns.map(run => new WorkflowRunNode(gitHubRepoContext, run));
  }
}