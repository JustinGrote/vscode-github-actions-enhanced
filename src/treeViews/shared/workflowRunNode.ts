import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { hasWritePermission, RepositoryPermission } from "~/git/repository-permissions"
import { logDebug, logTrace } from "~/log"
import { WorkflowJob, WorkflowRun, WorkflowRunAttempt } from "~/model"

import { createGithubCollection, GithubCollection } from "../collections/githubCollection"
import { GithubActionTreeNode } from "../githubActionTreeDataProvider"
import { getIconForWorkflowNode } from "../icons"
import { NoWorkflowJobsNode } from "./noWorkflowJobsNode"
import { getEventString, getStatusString } from "./runTooltipHelper"
import { WorkflowJobNode } from "./workflowJobNode"

export type WorkflowRunCommandArgs = Pick<WorkflowRunNode, "gitHubRepoContext" | "run">

export class WorkflowRunNode extends GithubActionTreeNode {
  private runId: number

  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun,
    private onJobUpdate?: () => void,
  ) {
    super(WorkflowRunNode._getLabel(run), vscode.TreeItemCollapsibleState.Collapsed)
    this.runId = run.id
    this.updateRun(run)
  }

  get hasPreviousAttempts(): boolean {
    return (this.run.run_attempt || 1) > 1
  }

  duration(): number {
    if (this.run.run_started_at) {
      const started_at = new Date(this.run.run_started_at)
      const updated_at = new Date(this.run.updated_at)
      return updated_at.getTime() - started_at.getTime()
    }
    return 0
  }

  updateRun(run: WorkflowRun) {
    this.run = run
    this.runId = run.id
    this.id = run.node_id.toString() // this is the GraphQL node id which should be globally unique and OK to use here, as vscode requires this ID to be unique across all objects in the tree
    this.label = WorkflowRunNode._getLabel(run)
    this.description = WorkflowRunNode._getDescription(run)
    this.contextValue = this.getContextValue(this.gitHubRepoContext.permissionLevel)
    this.iconPath = getIconForWorkflowNode(this.run)
    this.tooltip = this.getTooltip()
  }

  private jobsCollection: GithubCollection<WorkflowJob, { runId: number }> | undefined
  private jobsWatcher: ReturnType<GithubCollection<WorkflowJob, { runId: number }>["subscribeChanges"]> | undefined

  private async fetchJobs(): Promise<WorkflowJob[]> {
    logDebug(`Fetching jobs for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`)

    if (!this.jobsCollection) {
      this.jobsCollection = createGithubCollection(
        ["jobs", this.run.id.toString()],
        this.gitHubRepoContext.client,
        this.gitHubRepoContext.client.actions.listJobsForWorkflowRunAttempt,
        {
          owner: this.gitHubRepoContext.owner,
          repo: this.gitHubRepoContext.name,
          run_id: this.run.id,
          attempt_number: this.run.run_attempt || 1,
          per_page: 100,
        },
        (response) => response.data.jobs,
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        "id",
      )
    }

    if (!this.jobsWatcher) {
      logDebug(`👁️ Watching jobs for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`)
      this.jobsWatcher = this.jobsCollection.subscribeChanges((_changes) => {
        logDebug(
          `📋 Jobs change detected for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`,
        )
        // Fire the callback that jobs have changed, which our tree provider will signal to vscode to update.
        if (this.onJobUpdate) this.onJobUpdate()

        if (this.jobsCollection?.toArray.every((job) => job.status === "completed")) {
          logDebug(
            `🙈 All jobs are completed for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id}), stopping polling and unsubscribing the listener`,
          )
          this.jobsWatcher?.unsubscribe()
          // this.jobsCollection.cleanup();
        }
      })
    }

    return this.jobsCollection.toArrayWhenReady()
  }

  getContextValue(permission: RepositoryPermission): string {
    const contextValues = ["run"]
    const completed = this.run.status === "completed"
    if (hasWritePermission(permission)) {
      contextValues.push(completed ? "rerunnable" : "cancelable")
    }
    if (completed) {
      contextValues.push("completed")
    }
    return contextValues.join(" ")
  }

  async getChildren(): Promise<GithubActionTreeNode[]> {
    const jobs = await this.fetchJobs()
    // NOTE: because jobs are mostly readonly unlike runs, we can simplify the display process by just creating new nodes on each vscode request and telling it to update the job and refresh everything. This may be a poor assumption in the case of a ton of jobs and steps so we may need to do a more granular refresh on the UI in the future.
    const jobNodes: GithubActionTreeNode[] = jobs.map((job) => new WorkflowJobNode(this.gitHubRepoContext, job))

    if (this.hasPreviousAttempts) {
      jobNodes.push(new PreviousAttemptsNode(this.gitHubRepoContext, this.run))
    }

    if (jobNodes.length === 0) {
      return [new NoWorkflowJobsNode()]
    }
    return jobNodes
  }

  getTooltip(): vscode.MarkdownString {
    const parts: string[] = []

    // Header: Workflow name and run number
    if (this.run.name) {
      const runNumber = `#${this.run.run_number}`
      const attemptBadge = this.hasPreviousAttempts && this.run.run_attempt ? ` (Attempt ${this.run.run_attempt})` : ""
      parts.push(`## ${this.run.name} ${runNumber}${attemptBadge}`)
    }

    // Helper object for status/event formatting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tempRun = {
      run: this.run,
      duration: () => this.duration(),
      hasPreviousAttempts: this.hasPreviousAttempts,
    } as any

    // Status
    const statusLine = getStatusString(tempRun, false)
    parts.push(statusLine)

    parts.push("\n---\n")

    // Trigger/Event
    const eventLine = getEventString(tempRun)
    parts.push(eventLine)

    // Timestamps
    if (this.run.run_started_at) {
      const startDate = new Date(this.run.run_started_at)
      const formattedDate = startDate.toLocaleDateString() + " " + startDate.toLocaleTimeString()
      parts.push(`\nStarted ${formattedDate}`)
    }

    parts.push("\n---\n")

    // Branch
    const commitInfoParts: string[] = []
    if (this.run.head_branch) {
      const branchIcon = this.run.head_branch === this.run.head_repository?.default_branch ? "📌" : "🌿"
      if (this.run.repository) {
        const branchUrl = `${this.run.repository.html_url}/tree/${this.run.head_branch}`
        commitInfoParts.push(`${branchIcon} [**Branch:** \`${this.run.head_branch}\`](${branchUrl})`)
      } else {
        commitInfoParts.push(`${branchIcon} **Branch:** \`${this.run.head_branch}\``)
      }
    }

    // Commit
    if (this.run.head_sha) {
      const shortSha = this.run.head_sha.substring(0, 7)
      if (this.run.repository) {
        commitInfoParts.push(`📝 [\`${shortSha}\`](${this.run.repository.html_url}/commit/${this.run.head_sha})`)
      } else {
        commitInfoParts.push(`📝 **Commit:** \`${shortSha}\``)
      }
    }

    // Commit message
    if (this.run.head_commit?.message) {
      const firstLine = this.run.head_commit.message.split("\n")[0]
      const maxLength = 70
      const truncated = firstLine.length > maxLength ? firstLine.substring(0, maxLength) + "..." : firstLine
      commitInfoParts.push(`\n> ${truncated}`)
    }

    parts.push(commitInfoParts.join(" "))

    parts.push("\n---\n")

    // Workflow file
    if (this.run.path) {
      parts.push(`**Workflow:** \`${this.run.path}\`\n`)
    }

    // Repository
    if (this.run.repository?.html_url) {
      const repoLink = `[${this.run.repository.full_name}](${this.run.repository.html_url})`
      parts.push(`**Repository:** ${repoLink}\n`)
    }

    parts.push("---")

    // Run ID footer
    parts.push(`*Run ID: \`${this.run.id}\`*`)

    const markdownString = parts.join("\n")

    return new vscode.MarkdownString(markdownString)
  }

  private static _getLabel(run: WorkflowRun): string {
    return run.name || "Run " + run.id
  }
  private static _getDescription(run: WorkflowRun): string {
    const descriptionParts: string[] = [`#${run.run_number}`]
    if (run.run_attempt && run.run_attempt > 1) {
      descriptionParts.push(`[Attempt ${run.run_attempt}]`)
    }
    if (run.head_commit?.message) {
      descriptionParts.push(`- ${run.head_commit.message.split("\n")[0]}`)
    }
    return descriptionParts.join(" ")
  }
}

/** A workflow run attempt is just an instance of a WorkflowRun, so we can inherit most of the functionality */
export class WorkflowRunAttemptNode extends WorkflowRunNode {
  constructor(gitHubRepoContext: GitHubRepoContext, attempt: WorkflowRun) {
    super(gitHubRepoContext, attempt)
    this.id = `${this.run.node_id}-${this.run.run_attempt}`
  }

  get hasPreviousAttempts(): boolean {
    return false // Avoid a recursion from the inheritance
  }
}

/** NOTE: This must stay in the same module as WorkflowRunNode to avoid a circular dependency */
export class PreviousAttemptsNode extends GithubActionTreeNode {
  constructor(
    protected readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun,
  ) {
    super("Previous Attempts", vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon("history")
  }

  private async fetchAttempts(): Promise<WorkflowRunAttempt[]> {
    logTrace(
      `Fetching previous attempts for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`,
    )

    const attempts = this.run.run_attempt || 1
    const attemptRequests = []
    if (attempts > 1) {
      // Send the requests in parallel since there is no list API
      for (let i = 1; i < attempts; i++) {
        attemptRequests.push(
          this.gitHubRepoContext.client.actions
            .getWorkflowRunAttempt({
              owner: this.gitHubRepoContext.owner,
              repo: this.gitHubRepoContext.name,
              run_id: this.run.id,
              attempt_number: i,
            })
            .then((response) => response.data),
        )
      }

      return Promise.all(attemptRequests)
    }

    return []
  }

  async getChildren(): Promise<WorkflowRunNode[]> {
    const attempts = await this.fetchAttempts()
    return attempts
      .map((attempt) => new WorkflowRunAttemptNode(this.gitHubRepoContext, attempt))
      .map((attempt) => {
        attempt.id = `${this.run.id}-${attempt.run.run_attempt}`
        return attempt
      }) // Set the ID to a combination of the run ID and attempt number since the API doesn't return a unique ID for attempts
      .sort((a, b) => (b.run.run_attempt ?? 1) - (a.run.run_attempt ?? 1)) // Sort attempts in descending order so the most recent attempt is at the top
  }
}
