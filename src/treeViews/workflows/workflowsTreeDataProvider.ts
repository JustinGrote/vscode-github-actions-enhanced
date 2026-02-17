import * as vscode from "vscode";

import { canReachGitHubAPI } from "../../api/canReachGitHubAPI";
import { getGitHubContext } from "../../git/repository";
import { log, logDebug, logError, logTrace } from "../../log";
import { GithubActionTreeDataProvider } from "../githubActionTreeDataProvider";
import { AuthenticationNode } from "../shared/authenticationNode";
import { ErrorNode } from "../shared/errorNode";
import { GitHubAPIUnreachableNode } from "../shared/gitHubApiUnreachableNode";
import { NoGitHubRepositoryNode } from "../shared/noGitHubRepositoryNode";
import { NoWorkflowJobsNode } from "../shared/noWorkflowJobsNode";
import { WorkflowJobNode } from "../shared/workflowJobNode";
import { PreviousAttemptsNode, WorkflowRunAttemptNode, WorkflowRunNode } from "../shared/workflowRunNode";
import { WorkflowNode } from "./workflowNode";
import { getWorkflowNodes, WorkflowsRepoNode } from "./workflowsRepoNode";
import { WorkflowStepNode } from "../shared/workflowStepNode";
import { REFRESH_TREE_ROOT } from "../currentBranch/currentBranchTreeDataProvider";

type WorkflowsTreeNode =
  | AuthenticationNode
  | NoGitHubRepositoryNode
  | WorkflowNode
  | WorkflowRunNode
  | PreviousAttemptsNode
  | WorkflowRunAttemptNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | GitHubAPIUnreachableNode;

export class WorkflowsTreeDataProvider
  extends GithubActionTreeDataProvider<WorkflowsTreeNode>
{
  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Workflow Tree Node updated: ${node.description} ${node.label}`);
    this._onDidChangeTreeData.fire(node);
  }

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      this._onDidChangeTreeData.fire(REFRESH_TREE_ROOT);
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API");
    }
  }

  async getChildren(element?: WorkflowsTreeNode): Promise<WorkflowsTreeNode[]> {
    const children = await super.getChildren(element);
    if (children) return children

    // Root Refresh
    logDebug("🌲 Tree Root Request for Workflows");

    try {
      const gitHubContext = await getGitHubContext();
      if (!gitHubContext) {
        logDebug("could not get github context for workflows");
        return [new GitHubAPIUnreachableNode()];
      }

      if (gitHubContext.repos.length > 0) {
        // Special case, if there is only one repo, return workflow nodes directly
        if (gitHubContext.repos.length == 1) {
          return getWorkflowNodes(gitHubContext.repos[0]);
        }

        return gitHubContext.repos.map(r => new WorkflowsRepoNode(r));
      }

      log("No GitHub repositories found");
      return [];
    } catch (e) {
      logError(e as Error, "Failed to get GitHub context");

      if (`${(e as Error).message}`.startsWith("Could not get token from the GitHub authentication provider.")) {
        return [new AuthenticationNode()];
      }

      return [new ErrorNode(`An error has occurred: ${(e as Error).message}`)];
    }
  }
}
