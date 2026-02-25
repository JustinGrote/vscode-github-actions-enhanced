import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { WorkflowJob } from "~/model"
import { WorkflowStepNode } from "~/treeViews/shared/workflowStepNode"

import { GithubActionTreeNode } from "../githubActionTreeDataProvider"
import { getIconForWorkflowNode } from "../icons"

export class WorkflowJobNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly job: WorkflowJob,
  ) {
    super(job.name, (job.steps && job.steps.length > 0 && vscode.TreeItemCollapsibleState.Collapsed) || undefined)

    this.contextValue = "job"
    if (this.job.status === "completed") {
      this.contextValue += " completed"
      this.description = this.getNodeDuration(this.job)
    }

    this.iconPath = getIconForWorkflowNode(this.job)
    this.tooltip = this.getToolTip()
  }

  getChildren(): WorkflowStepNode[] {
    return (this.job.steps || []).map((s) => new WorkflowStepNode(this.gitHubRepoContext, this.job, s))
  }

  getToolTip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(`### [${this.job.name}](${this.job.html_url})  \n`, true)
    if (this.job.conclusion) {
      tooltip.appendMarkdown(`**Conclusion:** ${this.job.conclusion}  \n`)
    }
    tooltip.appendMarkdown(`**Status:** ${this.job.status}  \n`)

    tooltip.appendMarkdown(`\n---\n`)

    const startDate = new Date(this.job.started_at)
    const formattedDate = startDate.toLocaleDateString() + " " + startDate.toLocaleTimeString()
    tooltip.appendMarkdown(`**Started:** ${formattedDate}  \n`)

    if (this.job.completed_at) {
      const endDate = new Date(this.job.completed_at)
      const formattedDate = endDate.toLocaleDateString() + " " + endDate.toLocaleTimeString()
      tooltip.appendMarkdown(`**Completed:** ${formattedDate}  \n`)
    }
    if (this.job.runner_name) {
      tooltip.appendMarkdown(`**Runner:** ${this.job.runner_name}  \n`)
    }
    tooltip.appendMarkdown(`**Run ID:** ${this.job.run_id}  \n`)
    return tooltip
  }
}
