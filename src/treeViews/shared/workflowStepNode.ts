import {GitHubRepoContext} from "../../git/repository"
import {WorkflowJob, WorkflowStep} from "../../model"
import {GithubActionTreeNode} from "../githubActionTreeDataProvider"
import {getIconForWorkflowNode} from "../icons"

export class WorkflowStepNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly job: WorkflowJob,
    public readonly step: WorkflowStep,
  ) {
    super(step.name)

    this.contextValue = "step"
    if (this.step.status === "completed") {
      this.contextValue += " completed"
      this.description = this.getNodeDuration(this.step)
    }

    this.iconPath = getIconForWorkflowNode(this.step)
  }
}
