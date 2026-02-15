import * as vscode from "vscode";

import {GitHubRepoContext} from "../../git/repository";
import {hasWritePermission, RepositoryPermission} from "../../git/repository-permissions";
import {log, logDebug} from "../../log";
import { WorkflowRun, WorkflowJob as WorkflowJobModel } from "../../model";
import {WorkflowJob} from "../../store/WorkflowJob";
import {WorkflowRunAttempt} from "../../store/workflowRun";
import {getIconForWorkflowNode} from "../icons";
import {getEventString, getStatusString} from "./runTooltipHelper";
import {NoWorkflowJobsNode} from "./noWorkflowJobsNode";
import {PreviousAttemptsNode} from "./previousAttemptsNode";
import {WorkflowJobNode} from "./workflowJobNode";

export type WorkflowRunCommandArgs = Pick<WorkflowRunNode, "gitHubRepoContext" | "run">;

export class WorkflowRunNode extends vscode.TreeItem {

  private _jobs: Promise<WorkflowJob[]> | undefined;
  private _attempts: Promise<WorkflowRunAttempt[]> | undefined;

  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public run: WorkflowRun,
    public readonly workflowName?: string
  ) {
    super(WorkflowRunNode._getLabel(run, workflowName), vscode.TreeItemCollapsibleState.Collapsed);

    this.run = run;
    this.updateRun(run);
  }

  get hasPreviousAttempts(): boolean {
    return (this.run.run_attempt || 1) > 1;
  }

  duration(): number {
    if (this.run.run_started_at) {
      const started_at = new Date(this.run.run_started_at);
      const updated_at = new Date(this.run.updated_at);
      return updated_at.getTime() - started_at.getTime();
    }
    return 0;
  }

  updateRun(run: WorkflowRun) {
    if (this.run.status !== "completed" || this.run.updated_at !== run.updated_at) {
      // Refresh jobs if the run is not completed or it was updated (i.e. re-run)
      // For in-progress runs, we can't rely on updated at to change when jobs change
      this._jobs = undefined;
    }

    this.run = run;
    this.label = WorkflowRunNode._getLabel(run, this.workflowName);
    this.contextValue = this.getContextValue(this.gitHubRepoContext.permissionLevel);
    this.iconPath = getIconForWorkflowNode(this.run);
    this.tooltip = this.getTooltip();
  }

  jobs(): Promise<WorkflowJob[]> {
    if (!this._jobs) {
      this._jobs = this.fetchJobs();
    }
    return this._jobs;
  }

  private async fetchJobs(): Promise<WorkflowJob[]> {
    logDebug(`Fetching jobs for workflow run ${this.run.display_title} #${this.run.run_number} (${this.run.id})`);

    let jobs: WorkflowJobModel[] = [];

    try {
      jobs = await this.gitHubRepoContext.client.paginate(
        this.gitHubRepoContext.client.actions.listJobsForWorkflowRun,
        {
          owner: this.gitHubRepoContext.owner,
          repo: this.gitHubRepoContext.name,
          run_id: this.run.id,
          per_page: 100
        }
      );
    } catch (e) {
      await vscode.window.showErrorMessage((e as Error).message);
    }

    return jobs.map(j => new WorkflowJob(this.gitHubRepoContext, j));
  }

  getContextValue(permission: RepositoryPermission): string {
    const contextValues = ["run"];
    const completed = this.run.status === "completed";
    if (hasWritePermission(permission)) {
      contextValues.push(completed ? "rerunnable" : "cancelable");
    }
    if (completed) {
      contextValues.push("completed");
    }
    return contextValues.join(" ");
  }

  attempts(): Promise<WorkflowRunAttempt[]> {
    if (!this._attempts) {
      this._attempts = this._updateAttempts();
    }
    return this._attempts;
  }

  private async _updateAttempts(): Promise<WorkflowRunAttempt[]> {
    const attempts: WorkflowRunAttempt[] = [];

    const attempt = this.run.run_attempt || 1;
    if (attempt > 1) {
      for (let i = 1; i < attempt; i++) {
        const runAttemptResp = await this.gitHubRepoContext.client.actions.getWorkflowRunAttempt({
          owner: this.gitHubRepoContext.owner,
          repo: this.gitHubRepoContext.name,
          run_id: this.run.id,
          attempt_number: i
        });
        if (runAttemptResp.status !== 200) {
          log(
            "Failed to get workflow run attempt",
            this.run.id,
            "for attempt",
            i,
            runAttemptResp.status,
            runAttemptResp.data
          );
          continue;
        }

        const runAttempt = runAttemptResp.data;
        attempts.push(new WorkflowRunAttempt(this.gitHubRepoContext, runAttempt, i));
      }
    }

    return attempts;
  }

  async getJobs(): Promise<(WorkflowJobNode | NoWorkflowJobsNode | PreviousAttemptsNode)[]> {
    const jobs = await this.jobs();

    const children: (WorkflowJobNode | NoWorkflowJobsNode | PreviousAttemptsNode)[] = jobs.map(
      job => new WorkflowJobNode(this.gitHubRepoContext, job)
    );

    if (this.hasPreviousAttempts) {
      // Create a temporary WorkflowRun-like object for PreviousAttemptsNode
      const tempWorkflowRun = {
        attempts: () => this.attempts(),
      } as any;
      children.push(new PreviousAttemptsNode(this.gitHubRepoContext, tempWorkflowRun));
    }

    return children;
  }

  getTooltip(): vscode.MarkdownString {
    let markdownString = "";

    if (this.hasPreviousAttempts && this.run.run_attempt) {
      markdownString += `Attempt #${this.run.run_attempt} `;
    }

    // Create a temporary WorkflowRun-like object for helper functions
    const tempRun = {
      run: this.run,
      duration: () => this.duration(),
      hasPreviousAttempts: this.hasPreviousAttempts,
    } as any;

    markdownString += getStatusString(tempRun, markdownString.length == 0);
    markdownString += `\n\n`;
    markdownString += getEventString(tempRun);

    return new vscode.MarkdownString(markdownString);
  }

  private static _getLabel(run: WorkflowRun, workflowName?: string): string {
    return `${workflowName ? workflowName + " " : ""}#${run.run_number}`;
  }
}
