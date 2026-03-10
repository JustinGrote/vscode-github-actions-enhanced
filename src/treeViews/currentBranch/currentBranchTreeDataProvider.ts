import { match, P } from "ts-pattern"
import * as vscode from "vscode"

import { canReachGitHubAPI } from "~/api/canReachGitHubAPI"
import { getCurrentBranch, getGitHubContext, GitHubRepoContext } from "~/git/repository"
import { log, logDebug, logTrace, logWarn } from "~/log"
import { WorkflowJob, WorkflowRun, WorkflowRunAttempt } from "~/model"
import { CurrentBranchRepoNode } from "~/treeViews/currentBranch/currentBranchRepoNode"
import { NoRunForBranchNode } from "~/treeViews/currentBranch/noRunForBranchNode"
import { GithubActionTreeDataProvider } from "~/treeViews/githubActionTreeDataProvider"
import { WorkflowService } from "~/treeViews/services/workflowService"
import { GitHubAPIUnreachableNode } from "~/treeViews/shared/gitHubApiUnreachableNode"
import { NoWorkflowJobsNode } from "~/treeViews/shared/noWorkflowJobsNode"
import { WorkflowJobNode } from "~/treeViews/shared/workflowJobNode"
import { PreviousAttemptsNode, WorkflowRunAttemptNode, WorkflowRunNode } from "~/treeViews/shared/workflowRunNode"
import { WorkflowStepNode } from "~/treeViews/shared/workflowStepNode"

type CurrentBranchTreeNode =
  | CurrentBranchRepoNode
  | WorkflowRunNode
  | WorkflowRunAttemptNode
  | PreviousAttemptsNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | NoRunForBranchNode
  | GitHubAPIUnreachableNode

/** A "magic number" to signal to vscode to refresh the root of the tree */
export const REFRESH_TREE_ROOT = undefined

export class CurrentBranchTreeDataProvider extends GithubActionTreeDataProvider<CurrentBranchTreeNode> {
  private workflowService = WorkflowService.getInstance()
  private workflowRunNodes: Map<string, WorkflowRunNode> = new Map()
  private changeSubscriptions: Array<{ unsubscribe: () => void }> = []

  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Node updated: ${node.id} ${node.label}`)
    this._onDidChangeTreeData.fire(node)
  }

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      // This will tell vscode to subsequently call getChildren(undefined) for the root node
      this._onDidChangeTreeData.fire(REFRESH_TREE_ROOT)
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API")
    }
  }

  async getChildren(element?: CurrentBranchTreeNode | undefined): Promise<CurrentBranchTreeNode[]> {
    return match(element)
      .with(REFRESH_TREE_ROOT, () => this.getTreeRootChildren())
      .with(P.instanceOf(CurrentBranchRepoNode), (node) => this.getRunNodes(node.gitHubRepoContext, node.currentBranchName))
      .with(P.when((node): node is WorkflowRunNode => node instanceof WorkflowRunNode), (node) =>
        this.getWorkflowRunChildren(node as WorkflowRunNode),
      )
      .with(P.when((node): node is PreviousAttemptsNode => node instanceof PreviousAttemptsNode), (node) =>
        this.getPreviousAttemptNodes(node as PreviousAttemptsNode),
      )
      .with(P.when((node): node is WorkflowJobNode => node instanceof WorkflowJobNode), (node) =>
        this.getWorkflowJobChildren(node as WorkflowJobNode),
      )

      // Explicit leaves
      .with(P.instanceOf(NoWorkflowJobsNode), () => [])
      .with(P.instanceOf(WorkflowStepNode), () => [])
      .with(P.instanceOf(NoRunForBranchNode), () => [])
      .with(P.instanceOf(GitHubAPIUnreachableNode), () => [])

      .otherwise(() => {
        logTrace(`Unspecified element type: ${element?.constructor.name}, assuming leaf node and returning empty array`)
        return []
      })
  }

  private async getTreeRootChildren(): Promise<CurrentBranchTreeNode[]> {
    const gitHubContext = await getGitHubContext()
    if (!gitHubContext) {
      return [new GitHubAPIUnreachableNode()]
    }

    const repoNodes = gitHubContext.repos
      .map((repoContext): CurrentBranchRepoNode | undefined => {
        const currentBranch = getCurrentBranch(repoContext.repositoryState)
        if (!currentBranch) {
          logWarn(`Could not find current branch for ${repoContext.name}`)
          return undefined
        }
        return new CurrentBranchRepoNode(repoContext, currentBranch)
      })
      .filter((x) => x !== undefined) as CurrentBranchRepoNode[]

    if (gitHubContext.repos.length === 0) {
      logWarn("No GitHub repositories found in context")
      return []
    }

    if (gitHubContext.repos.length === 1) {
      logDebug("Only one GitHub repository found in context, expanding it by default to save a click.")
      const singleRepoNode = repoNodes[0]
      return await this.getRunNodes(singleRepoNode.gitHubRepoContext, singleRepoNode.currentBranchName)
    }

    // Multi-Repository view
    return repoNodes
  }

  private async getRunNodes(
    gitHubRepoContext: GitHubRepoContext,
    currentBranchName?: string,
  ): Promise<WorkflowRunNode[] | NoRunForBranchNode[]> {
    logDebug(`Getting current branch (${currentBranchName}) runs in repo ${gitHubRepoContext.name}`)

    if (!currentBranchName) {
      return [new NoRunForBranchNode()]
    }

    // Subscribe to changes if not already subscribed
    const collectionKey = this.getRepoKey(gitHubRepoContext)
    if (!this.changeSubscriptions.some((sub) => (sub as any).key === collectionKey)) {
      const subscription = this.workflowService.subscribeToWorkflowRunChanges(gitHubRepoContext, (changes) => {
        logDebug(`🚨 Workflow run changes detected for ${gitHubRepoContext.name}, refreshing tree`)
        // Refresh the entire tree for simplicity when runs change
        this._onDidChangeTreeData.fire(REFRESH_TREE_ROOT)
      })
      ;(subscription as any).key = collectionKey
      this.changeSubscriptions.push(subscription)
      logDebug(`👁️ Subscribed to workflow run changes for repo ${gitHubRepoContext.name}`)
    }

    // Get runs filtered by branch from the service
    const runs = await this.workflowService.getWorkflowRunsByBranch(gitHubRepoContext, currentBranchName)

    if (runs.length === 0) {
      return [new NoRunForBranchNode()]
    }

    // Limit to most recent runs
    const recentRuns = runs.slice(0, 30)
    const runNodes = recentRuns.map((run) => this.toWorkflowRunNode(run, gitHubRepoContext))

    return runNodes
  }

  private async getWorkflowRunChildren(node: WorkflowRunNode): Promise<CurrentBranchTreeNode[]> {
    const jobs = await this.getWorkflowRunJobs(node)
    const jobNodes: CurrentBranchTreeNode[] = jobs.map((job) => new WorkflowJobNode(node.gitHubRepoContext, job))

    if (node.hasPreviousAttempts) {
      jobNodes.push(new PreviousAttemptsNode(node.gitHubRepoContext, node.run))
    }

    if (jobNodes.length === 0) {
      return [new NoWorkflowJobsNode()]
    }

    return jobNodes
  }

  private getWorkflowJobChildren(node: WorkflowJobNode): WorkflowStepNode[] {
    return (node.job.steps || []).map((step) => new WorkflowStepNode(node.gitHubRepoContext, node.job, step))
  }

  private async getPreviousAttemptNodes(node: PreviousAttemptsNode): Promise<WorkflowRunAttemptNode[]> {
    logTrace(`Fetching previous attempts for workflow run ${node.run.display_title} #${node.run.run_number} (${node.run.id})`)

    const attempts = node.run.run_attempt || 1
    const attemptRequests = []
    if (attempts > 1) {
      for (let i = 1; i < attempts; i++) {
        attemptRequests.push(
          node.gitHubRepoContext.client.actions
            .getWorkflowRunAttempt({
              owner: node.gitHubRepoContext.owner,
              repo: node.gitHubRepoContext.name,
              run_id: node.run.id,
              attempt_number: i,
            })
            .then((response) => response.data),
        )
      }
    }

    const previousAttempts: WorkflowRunAttempt[] = await Promise.all(attemptRequests)
    return previousAttempts
      .map((attempt) => new WorkflowRunAttemptNode(node.gitHubRepoContext, attempt))
      .map((attempt) => {
        attempt.id = `${node.run.id}-${attempt.run.run_attempt}`
        return attempt
      })
      .sort((a, b) => (b.run.run_attempt ?? 1) - (a.run.run_attempt ?? 1))
  }

  private async getWorkflowRunJobs(node: WorkflowRunNode): Promise<WorkflowJob[]> {
    logDebug(`Fetching jobs for workflow run ${node.run.display_title} #${node.run.run_number} (${node.run.id})`)

    const jobs = await this.workflowService.getWorkflowRunJobs(
      node.gitHubRepoContext,
      node.run
    )

    // Subscribe to job changes to update the node
    const subscription = await this.workflowService.subscribeToJobChanges(
      node.gitHubRepoContext,
      node.run,
      () => {
        logDebug(`📋 Jobs change detected for workflow run ${node.run.display_title} #${node.run.run_number} (${node.run.id})`)
        this._updateNode(node)
      },
    )
    this.changeSubscriptions.push(subscription)

    return jobs
  }

  private toWorkflowRunNode(run: WorkflowRun, gitHubRepoContext: GitHubRepoContext) {
    const runKey = this.getRunNodeKey(gitHubRepoContext, run.id)
    const existingNode = this.workflowRunNodes.get(runKey)
    if (existingNode) {
      logTrace(`🖊️ Run ${run.id} already exists in tree, reusing existing node and updating its data`)
      existingNode.update(run)
      return existingNode
    }

    logTrace(`➕ Adding run ${run.id} ${run.name} #${run.run_number} to tree`)
    const workflowRunNode = new WorkflowRunNode(gitHubRepoContext, run)
    this.workflowRunNodes.set(runKey, workflowRunNode)
    return workflowRunNode
  }

  private getRepoKey(gitHubRepoContext: GitHubRepoContext): string {
    return `${gitHubRepoContext.owner}/${gitHubRepoContext.name}`
  }

  private getRunNodeKey(gitHubRepoContext: GitHubRepoContext, runId: number): string {
    return `${this.getRepoKey(gitHubRepoContext)}/${runId}`
  }
}
