import * as vscode from "vscode";
import {GitHubRepoContext} from "../../git/repository";
import {getIconForWorkflowNode} from "../icons";
import {WorkflowStepNode} from "../workflows/workflowStepNode";
import { WorkflowJob } from "../../model";
import { GithubActionTreeNode } from "../githubActionTreeDataProvider";

export class WorkflowJobNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly job: WorkflowJob
  ) {
    super(
      job.name,
      (job.steps && job.steps.length > 0 && vscode.TreeItemCollapsibleState.Collapsed) || undefined
    );

    this.contextValue = "job";
    if (this.job.status === "completed") {
      this.contextValue += " completed";
    }

    this.iconPath = getIconForWorkflowNode(this.job);
  }

  hasSteps(): boolean {
    return !!(this.job.steps && this.job.steps.length > 0);
  }

  getChildren(): WorkflowStepNode[] {
    return (this.job.steps || []).map(s => new WorkflowStepNode(this.gitHubRepoContext, this.job, s));
  }
}