import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { hasWritePermission, RepositoryPermission } from "~/git/repository-permissions"
import { WorkflowRun } from "~/model"

import { GithubActionTreeNode } from "../githubActionTreeDataProvider"
import { getIconForWorkflowNode } from "../icons"
import { getEventString, getStatusString } from "./runTooltipHelper"

export type WorkflowRunCommandArgs = Pick<WorkflowRunNode, "gitHubRepoContext" | "run">

export class WorkflowRunNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun,
  ) {
    super(WorkflowRunNode._getLabel(run), vscode.TreeItemCollapsibleState.Collapsed)
    this.update(run)
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

  update(run: WorkflowRun) {
    this.run = run
    this.id = run.node_id // this is the GraphQL node id which should be globally unique and OK to use here, as vscode requires this ID to be unique across all objects in the tree
    this.label = WorkflowRunNode._getLabel(run)
    this.description = WorkflowRunNode._getDescription(run)
    this.contextValue = this.getContextValue(this.gitHubRepoContext.permissionLevel)
    this.iconPath = getIconForWorkflowNode(this.run)
    this.tooltip = this.getTooltip()
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
    public readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun,
  ) {
    super("Previous Attempts", vscode.TreeItemCollapsibleState.Collapsed)
    this.iconPath = new vscode.ThemeIcon("history")
  }
}
