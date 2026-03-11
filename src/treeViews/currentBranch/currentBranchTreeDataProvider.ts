import { match, P } from "ts-pattern"
import * as vscode from "vscode"

import { getCurrentBranch, getGitHubContext, GitHubRepoContext } from "~/git/repository"
import { logDebug, logError, logTrace, logWarn } from "~/log"
import { CurrentBranchRepoNode } from "~/treeViews/currentBranch/currentBranchRepoNode"
import { NoRunForBranchNode } from "~/treeViews/currentBranch/noRunForBranchNode"
import { GitHubAPIUnreachableNode } from "~/treeViews/shared/gitHubApiUnreachableNode"
import { NoWorkflowJobsNode } from "~/treeViews/shared/noWorkflowJobsNode"
import { WorkflowJobNode } from "~/treeViews/shared/workflowJobNode"
import { PreviousAttemptsNode, WorkflowRunAttemptNode, WorkflowRunNode } from "~/treeViews/shared/workflowRunNode"
import { WorkflowStepNode } from "~/treeViews/shared/workflowStepNode"

import { WorkflowRunView } from "../services/workflowService"
import { NoGitHubRepositoryNode } from "../shared/noGitHubRepositoryNode"
import { WorkflowsTreeDataProvider } from "../workflows/workflowsTreeDataProvider"

type CurrentBranchTreeNode =
  | ExpandableCurrentBranchTreeNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | NoRunForBranchNode
  | GitHubAPIUnreachableNode

type ExpandableCurrentBranchTreeNode =
  | CurrentBranchRepoNode
  | WorkflowRunNode
  | WorkflowRunAttemptNode
  | PreviousAttemptsNode
  | WorkflowJobNode

/** A "magic number" to signal to vscode to refresh the root of the tree */
export const REFRESH_TREE_ROOT = undefined

/** Presents a view of workflows filtered to the current branch. */
export class CurrentBranchTreeDataProvider extends WorkflowsTreeDataProvider {
  async getChildren(node: ExpandableCurrentBranchTreeNode): Promise<CurrentBranchTreeNode[]> {
    return match(node)
      .with(P.nullish, () => this.getTreeRootChildren())
      .with(P.instanceOf(CurrentBranchRepoNode), (node) => this.getBranchNodeChildren(node as CurrentBranchRepoNode))
      .otherwise(() => super.getChildren(node))
  }

  /** used to track the state of the root repo, for purposes of deciding where to refresh on detected changes */
  private multiRepoRoot = false
  async getTreeRootChildren(): Promise<CurrentBranchTreeNode[]> {
    logDebug("🌲 Tree Root Request for Current Branch")
    const gitHubContext = await getGitHubContext()
    if (!gitHubContext) {
      logDebug("could not get github context for workflows")
      return [new GitHubAPIUnreachableNode()]
    }
    if (gitHubContext.repos.length === 0) {
      logWarn("No GitHub repositories found")
      return [new NoGitHubRepositoryNode()]
    }

    const repoNodes = gitHubContext.repos
      .filter((repoContext) => {
        const currentBranchName = getCurrentBranch(repoContext.repositoryState)
        if (!currentBranchName) {
          logWarn(
            `Could not get current branch for repo ${repoContext.name}. This shouldn't happen and is probably a bug.`,
          )
          return false
        }
        return true
      })
      .map((repoContext) => {
        const currentBranchName = getCurrentBranch(repoContext.repositoryState)
        if (currentBranchName === undefined) {
          const err = new Error(
            `currentBranchName for ${repoContext.name} is unexpectedly undefined. This shouldn't happen and is probably a bug.`,
          )
          logError(err)
          throw err
        }
        return new CurrentBranchRepoNode(repoContext, currentBranchName)
      })

    if (repoNodes.length === 1) {
      // If there is only one repo, we expand it by default to avoid an unnecessary click for the user
      this.multiRepoRoot = false
      return await this.getChildren(repoNodes[0])
    }

    this.multiRepoRoot = true
    return repoNodes
  }

  private branchNodeUpdates = new Map<string, vscode.Disposable>()
  async getBranchNodeChildren(node: CurrentBranchRepoNode, isRoot = false): Promise<CurrentBranchTreeNode[]> {
    const children = await this.getBranchWorkflowRunNodes(node.gitHubRepoContext, node.currentBranchName)
    // Subscribe to changes in the workflow runs for this branch so we can update the tree in real time as new runs are created or existing runs are updated
    const view = await WorkflowRunView.create(node.gitHubRepoContext, node.currentBranchName)
    const updateMonitorKey = `${node.gitHubRepoContext.owner}/${node.gitHubRepoContext.name}/${node.currentBranchName}`
    if (!this.branchNodeUpdates.has(updateMonitorKey)) {
      logTrace(
        `👁️ Subscribing to workflow run updates for branch ${node.currentBranchName} in repo ${node.gitHubRepoContext.name}`,
      )
      const disposable = view.subscribe(() => {
        logDebug(
          `✨ Workflow runs updated for branch ${node.currentBranchName} in repo ${node.gitHubRepoContext.name}, refreshing ...`,
        )
        // If a multi repo root, we only need to refresh the specific repo node.
        this.triggerUIRefresh(this.multiRepoRoot ? node : REFRESH_TREE_ROOT)
      })
      this.branchNodeUpdates.set(updateMonitorKey, disposable)
    }
    return children
  }

  async getBranchWorkflowRunNodes(
    githubRepoContext: GitHubRepoContext,
    branchName: string,
  ): Promise<WorkflowRunNode[]> {
    const runs = await this.getWorkflowRuns(githubRepoContext, branchName)
    return runs
      .map((run) => new WorkflowRunNode(githubRepoContext, run))
      .sort((a, b) => new Date(b.run.created_at).getTime() - new Date(a.run.created_at).getTime())
  }
}
