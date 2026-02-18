import {GitHubRepoContext} from "../../git/repository";
import {WorkflowJob, WorkflowStep} from "../../model";
import {getIconForWorkflowNode} from "../icons";
import {GithubActionTreeNode} from "../githubActionTreeDataProvider";

export class WorkflowStepNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly job: WorkflowJob,
    public readonly step: WorkflowStep
  ) {
    super(step.name);

    this.contextValue = "step";
    if (this.step.status === "completed") {
      this.contextValue += " completed";
    }

    this.iconPath = getIconForWorkflowNode(this.step);
  }
}
