import { match, P } from "ts-pattern"
import * as vscode from "vscode"

import { canReachGitHubAPI } from "~/api/canReachGitHubAPI"
import { getGitHubContext, GitHubRepoContext } from "~/git/repository"
import { logDebug, logError, logTrace,logWarn } from "~/log"
import { Workflow, WorkflowJob, WorkflowRun } from "~/model"
import { REFRESH_TREE_ROOT } from "~/treeViews/currentBranch/currentBranchTreeDataProvider"
import { GithubActionTreeDataProvider, GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"
import { WorkflowRunView, WorkflowService } from "~/treeViews/services/workflowService"
import { AuthenticationNode } from "~/treeViews/shared/authenticationNode"
import { ErrorNode } from "~/treeViews/shared/errorNode"
import { GitHubAPIUnreachableNode } from "~/treeViews/shared/gitHubApiUnreachableNode"
import { NoGitHubRepositoryNode } from "~/treeViews/shared/noGitHubRepositoryNode"
import { NoWorkflowJobsNode } from "~/treeViews/shared/noWorkflowJobsNode"
import { WorkflowJobNode } from "~/treeViews/shared/workflowJobNode"
import { PreviousAttemptsNode, WorkflowRunAttemptNode, WorkflowRunNode } from "~/treeViews/shared/workflowRunNode"
import { WorkflowStepNode } from "~/treeViews/shared/workflowStepNode"
import { WorkflowNode } from "~/treeViews/workflows/workflowNode"
import { WorkflowsRepoNode } from "~/treeViews/workflows/workflowsRepoNode"

type WorkflowsTreeNode =
  | AuthenticationNode
  | NoGitHubRepositoryNode
  | ErrorNode
  | WorkflowsRepoNode
  | WorkflowNode
  | WorkflowRunNode
  | WorkflowRunAttemptNode
  | PreviousAttemptsNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | GitHubAPIUnreachableNode

/** A data presenter that handles all fetching from GitHub and presenting it in the VSCode tree view */
export class WorkflowsTreeDataProvider extends GithubActionTreeDataProvider<WorkflowsTreeNode> {
  protected workflowService: WorkflowService = WorkflowService.getInstance()
  private workflowNodes: Map<string, WorkflowNode> = new Map()
  private workflowRunNodes: Map<string, WorkflowRunNode> = new Map()
  private changeSubscriptions: Array<{ unsubscribe: () => void }> = []

  protected triggerUIRefresh(node: GithubActionTreeNode | typeof REFRESH_TREE_ROOT): void {
    logTrace(`⬆️ Refresh: ${node === REFRESH_TREE_ROOT ? "🌲 Root" : node.label}`)
    this._onDidChangeTreeData.fire(node)
  }

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      this.triggerUIRefresh(REFRESH_TREE_ROOT)
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API")
    }
  }

  /** The entrypoint from vscode for all node types in the tree */
  async getChildren(element?: WorkflowsTreeNode): Promise<WorkflowsTreeNode[]> {
    return match(element)
      .with(REFRESH_TREE_ROOT, () => this.getTreeRootChildren())
      .with(P.instanceOf(WorkflowsRepoNode), (node) => this.getWorkflowNodes(node.gitHubRepoContext))
      .with(P.instanceOf(WorkflowNode), (node) => this.getWorkflowChildren(node))
      .with(P.instanceOf(WorkflowRunNode), (node) => this.getWorkflowRunChildren(node))
      .with(P.instanceOf(PreviousAttemptsNode), (node) => this.getPreviousAttemptNodes(node))
      .with(P.instanceOf(WorkflowJobNode), (node) => this.getWorkflowJobChildren(node))

      // Explicit leaf nodes
      .with(P.instanceOf(AuthenticationNode), () => [])
      .with(P.instanceOf(NoGitHubRepositoryNode), () => [])
      .with(P.instanceOf(ErrorNode), () => [])
      .with(P.instanceOf(NoWorkflowJobsNode), () => [])
      .with(P.instanceOf(WorkflowStepNode), () => [])
      .with(P.instanceOf(GitHubAPIUnreachableNode), () => [])

      .exhaustive()
  }

  /** Gets the root nodes for the tree. Can be reimplemented in derived classes for different views */
  protected async getTreeRootChildren(): Promise<WorkflowsTreeNode[]> {
    // Root Refresh
    logDebug("🌲 Tree Root Request for Workflows")

    try {
      const gitHubContext = await getGitHubContext()
      if (!gitHubContext) {
        logDebug("could not get github context for workflows")
        return [new GitHubAPIUnreachableNode()]
      }

      if (gitHubContext.repos.length === 0) {
        logWarn("No GitHub repositories found")
        return [new NoGitHubRepositoryNode()]
      }

      const repoNodes = gitHubContext.repos.map((r) => new WorkflowsRepoNode(r))

      // Special case, if there is only one repo, return workflow nodes directly to skip an unnecessary level in the tree
      if (repoNodes.length === 1) return await this.getChildren(repoNodes[0])

      return repoNodes
    } catch (e) {
      logError(e as Error, "Failed to get GitHub context")

      if (`${(e as Error).message}`.startsWith("Could not get token from the GitHub authentication provider.")) {
        return [new AuthenticationNode()]
      }

      return [new ErrorNode(`An error has occurred: ${(e as Error).message}`)]
    }
  }

  async getWorkflowNodes(gitHubRepoContext: GitHubRepoContext, branchName?: string): Promise<WorkflowNode[]> {
    logDebug(`Getting workflow nodes for repo ${gitHubRepoContext.name} (derived from workflow runs)`)

    const view = await WorkflowRunView.create(gitHubRepoContext, branchName)
    const groupedRuns = await this.getWorkflowRunsGroupedByName(view)

    // Create workflow nodes from grouped runs
    const workflowNodes: WorkflowNode[] = []
    for (const [workflowName, runs] of groupedRuns.entries()) {
      if (runs.length === 0) continue

      // Use the most recent run to derive workflow metadata
      const latestRun = runs[0]
      const syntheticWorkflow: Workflow = {
        id: latestRun.workflow_id,
        name: workflowName,
        path: latestRun.path,
        state: "active",
        created_at: latestRun.created_at,
        updated_at: latestRun.updated_at,
        url: latestRun.workflow_url || "",
        html_url: latestRun.workflow_url || "",
        badge_url: "",
        node_id: `workflow_${latestRun.workflow_id}`,
      }

      const node = this.toWorkflowNode(syntheticWorkflow, gitHubRepoContext)
      workflowNodes.push(node)
    }

    // Sort by name
    workflowNodes.sort((a, b) => a.wf.name.localeCompare(b.wf.name))

    // Refresh once on node tree change, this will be resubscribed after refresh
    logDebug(`👁️ Subscribed to workflow run changes for repo ${gitHubRepoContext.name}`)
    view.subscribe(async () => {
      logDebug(`🚨 Workflow run changes detected for ${gitHubRepoContext.name}, refreshing tree`)
      this.triggerUIRefresh(REFRESH_TREE_ROOT)
    }, true)

    return workflowNodes
  }

  async getWorkflowRuns(githubRepoContext: GitHubRepoContext, branchName?: string): Promise<WorkflowRun[]> {
    const view = await WorkflowRunView.create(githubRepoContext, branchName)
    return await view.get()
  }

  async getWorkflowRunsGroupedByName(view: WorkflowRunView) {
    const runs = await view.get()
    const grouped = new Map<string, WorkflowRun[]>()
    for (const run of runs) {
      const workflowName = run.name || `Workflow ${run.workflow_id}`
      if (!grouped.has(workflowName)) {
        grouped.set(workflowName, [])
      }
      grouped.get(workflowName)!.push(run)
    }
    return grouped
  }

  private async getWorkflowChildren(workflowNode: WorkflowNode): Promise<WorkflowRunNode[]> {
    logDebug(`Getting workflow runs for workflow ${workflowNode.wf.name} (${workflowNode.wf.id})`)

    const runs = await this.getWorkflowRuns(workflowNode.gitHubRepoContext)
    // Get runs for this specific workflow from the service
    const workflowRuns = runs.filter((run) => run.workflow_id === workflowNode.wf.id)
    return workflowRuns.map((run) => this.toWorkflowRunNode(run, workflowNode))
  }

  private async getWorkflowRunChildren(node: WorkflowRunNode): Promise<WorkflowsTreeNode[]> {
    const jobs = await this.getWorkflowRunJobs(node)
    const jobNodes: WorkflowsTreeNode[] = jobs.map((job) => new WorkflowJobNode(node.gitHubRepoContext, job))

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
    logTrace(`Fetching previous attempts for workflow run ${node.mostRecentRun.display_title} #${node.mostRecentRun.run_number} (${node.mostRecentRun.id})`)

    const attempts = node.mostRecentRun.run_attempt || 1
    if (attempts <= 1) {
      logWarn(`Previous Attempts node created for ${node.id} but it has only ${attempts} attempt(s), expected more than 1. This node should not have been created.`)
      return []
    }

    const gitHubRepoContext = node.gitHubRepoContext
    const view = await WorkflowRunView.create(gitHubRepoContext)

    // TODO: Redo this as a live query
    const runs = await view.get()
    const previousAttemptRuns = runs.filter(
      (run) =>
        run.id === node.mostRecentRun.id &&
        run.run_attempt !== undefined &&
        run.run_attempt < (node.mostRecentRun.run_attempt || 1)
    )

    // Return in descending order
    return previousAttemptRuns
      .map((attempt) => new WorkflowRunAttemptNode(node.gitHubRepoContext, attempt))
      .sort((a, b) => (b.run.run_attempt ?? 1) - (a.run.run_attempt ?? 1))
  }

  private async getWorkflowRunJobs(node: WorkflowRunNode): Promise<WorkflowJob[]> {
    logDebug(`Fetching jobs for workflow run ${node.run.display_title} #${node.run.run_number} (${node.run.id})`)

    const jobs = await this.workflowService.getWorkflowRunJobs(
      node.gitHubRepoContext,
      node.run
    )

    // If the run is concluded, no need to subscribe to job changes
    if (node.run.conclusion) return jobs

    // Subscribe to job changes to update the node
    const subscription = await this.workflowService.subscribeToJobChanges(
      node.gitHubRepoContext,
      node.run,
      (_changes) => {
        logDebug(`📋 Jobs change detected for workflow run ${node.run.display_title} #${node.run.run_number} (${node.run.id})`)
        this.triggerUIRefresh(node)
      },
    )
    this.changeSubscriptions.push(subscription)

    return jobs
  }

  toWorkflowNode(workflow: Workflow, gitHubRepoContext: GitHubRepoContext): WorkflowNode {
    const workflowKey = this.getWorkflowNodeKey(gitHubRepoContext, workflow.id)
    const existingNode = this.workflowNodes.get(workflowKey)
    if (existingNode) {
      logTrace(`🖊️ Workflow ${workflow.id} already exists in tree, reusing existing node and updating its data`)
      existingNode.updateWorkflow(workflow)
      return existingNode
    }

    const nameWithoutNewlines = workflow.name.replace(/(\r\n|\n|\r)/gm, " ")
    workflow.name = nameWithoutNewlines

    const node = new WorkflowNode(gitHubRepoContext, workflow)
    this.workflowNodes.set(workflowKey, node)
    return node
  }

  toWorkflowRunNode(run: WorkflowRun, workflowNode: WorkflowNode): WorkflowRunNode {
    const runKey = this.getWorkflowRunNodeKey(workflowNode.gitHubRepoContext, workflowNode.wf.id, run.id)
    const existingNode = this.workflowRunNodes.get(runKey)
    if (existingNode) {
      logTrace(`🖊️ Run ${run.id} already exists in tree, reusing existing node and updating its data`)
      existingNode.update(run)
      return existingNode
    }

    logTrace(`➕ Adding run ${run.id} ${run.name} #${run.run_number} to tree`)
    const workflowRunNode = new WorkflowRunNode(workflowNode.gitHubRepoContext, run)
    this.workflowRunNodes.set(runKey, workflowRunNode)
    return workflowRunNode
  }

  private getRepoKey(gitHubRepoContext: GitHubRepoContext): string {
    return `${gitHubRepoContext.owner}/${gitHubRepoContext.name}`
  }

  private getWorkflowNodeKey(gitHubRepoContext: GitHubRepoContext, workflowId: string | number): string {
    return `${this.getRepoKey(gitHubRepoContext)}/${workflowId}`
  }

  private getWorkflowRunNodeKey(
    gitHubRepoContext: GitHubRepoContext,
    workflowId: string | number,
    runId: number,
  ): string {
    return `${this.getWorkflowNodeKey(gitHubRepoContext, workflowId)}/${runId}`
  }
}
