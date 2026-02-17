import * as vscode from "vscode";
import {GitHubRepoContext} from "../../git/repository";
import { WorkflowRunNode } from "./workflowRunNode";
import { WorkflowRun,WorkflowRunAttempt } from "../../model";
import { logTrace } from "../../log";
import { WorkflowRunAttemptNode } from "./workflowRunAttemptNode";

export class PreviousAttemptsNode extends vscode.TreeItem {
  constructor(
    protected readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun
  ) {
    super("Previous Attempts", vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("history");
  }

  private async fetchAttempts(): Promise<WorkflowRunAttempt[]> {
    logTrace(`Fetching previous attempts for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`);

    const attempts = this.run.run_attempt || 1;
    const attemptRequests = [];
    if (attempts > 1) {
      // Send the requests in parallel since there is no list API
      for (let i = 1; i < attempts; i++) {
        attemptRequests
          .push(this.gitHubRepoContext.client.actions.getWorkflowRunAttempt({
            owner: this.gitHubRepoContext.owner,
            repo: this.gitHubRepoContext.name,
            run_id: this.run.id,
            attempt_number: i
          })
          .then(response => response.data)
        )
      }

      return Promise.all(attemptRequests)
    }

    return []
  }

  async getAttempts(): Promise<WorkflowRunNode[]> {
    const attempts = await this.fetchAttempts();
    return attempts
      .map(attempt => new WorkflowRunAttemptNode(this.gitHubRepoContext, attempt))
      .map(attempt => {
        attempt.id = `${this.run.id}-${attempt.run.run_attempt}`
        return attempt
      }) // Set the ID to a combination of the run ID and attempt number since the API doesn't return a unique ID for attempts
      .sort((a, b) => (b.run.run_attempt ?? 1) - (a.run.run_attempt ?? 1)); // Sort attempts in descending order so the most recent attempt is at the top
  }
}
