import {GitHubRepoContext} from "../../git/repository";
import { WorkflowRunAttempt } from "../../model";
import { WorkflowRunNode } from "./workflowRunNode";

/** A workflow run attempt is just an instance of a WorkflowRun, so we can inherit most of the functionality */
export class WorkflowRunAttemptNode extends WorkflowRunNode {
  constructor(
    gitHubRepoContext: GitHubRepoContext,
    attempt: WorkflowRunAttempt
  ) {
    super(gitHubRepoContext, attempt);
    this.id = `${this.run.node_id}-${this.run.run_attempt}`;
  }

  get hasPreviousAttempts(): boolean {
    return false; // Avoid a recursion from the inheritance
  }
}
