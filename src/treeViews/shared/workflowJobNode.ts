import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { WorkflowJob } from "~/model"

import { GithubActionTreeNode } from "../githubActionTreeDataProvider"
import { getIconForWorkflowNode } from "../icons"

export class WorkflowJobNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public job: WorkflowJob,
  ) {
    super(job.name, WorkflowJobNode.getCollapsibleState(job))
    this.update(job)
  }

  update(job: WorkflowJob) {
    this.job = job
    this.id = job.node_id
    this.label = job.name
    this.description = job.status === "completed" ? this.getNodeDuration(job) : undefined
    this.collapsibleState = WorkflowJobNode.getCollapsibleState(job)
    this.contextValue = "job"
    if (job.status === "completed") {
      this.contextValue += " completed"
    }
    this.iconPath = getIconForWorkflowNode(job)
    this.tooltip = this.getToolTip()
  }

  // NOTE: Has to be static because we need to call it in the super()
  static getCollapsibleState(job: WorkflowJob): vscode.TreeItemCollapsibleState | undefined {
    return WorkflowJobNode.hasSteps(job)
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None
  }

  static hasSteps(job: WorkflowJob): boolean {
    return (job.steps && job.steps.length > 0) || false
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
