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
  ) {
    super(WorkflowRunNode._getLabel(run), vscode.TreeItemCollapsibleState.Collapsed);
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
    this.id = run.id.toString() // this is the GraphQL node id which should be globally unique and OK to use here.
    this.label = WorkflowRunNode._getLabel(run);
    this.description = WorkflowRunNode._getDescription(run);
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
    const parts: string[] = [];

    // Title with name and number
    if (this.run.name) {
      parts.push(`## ${this.run.name}`);
    }

    // Attempt and Run Number
    const runHeader = [
      `#${this.run.run_number}`,
      this.hasPreviousAttempts && this.run.run_attempt ? `${this.run.run_attempt} attempts` : null
    ].filter(Boolean).join(" • ");

    // Add hyperlink to workflow run
    const runLink = this.run.html_url ? `[${runHeader}](${this.run.html_url})` : runHeader;
    parts.push(runLink);

    parts.push("---");

    // Status and Duration
    const tempRun = {
      run: this.run,
      duration: () => this.duration(),
      hasPreviousAttempts: this.hasPreviousAttempts,
    } as any;

    parts.push(`**Status:** ${getStatusString(tempRun, false)}`);

    // Event Information
    parts.push(`**Triggered:** ${getEventString(tempRun)}`);

    // Branch Information with link
    if (this.run.head_branch && this.run.repository) {
      const branchIcon = this.run.head_branch === this.run.head_repository?.default_branch ? "📌" : "🌿";
      const branchUrl = `${this.run.repository.html_url}/tree/${this.run.head_branch}`;
      const branchLink = `[${branchIcon} \`${this.run.head_branch}\`](${branchUrl})`;
      parts.push(`**Branch:** ${branchLink}`);
    } else if (this.run.head_branch) {
      const branchIcon = this.run.head_branch === this.run.head_repository?.default_branch ? "📌" : "🌿";
      parts.push(`**Branch:** ${branchIcon} \`${this.run.head_branch}\``);
    }

    // Commit Information with link
    if (this.run.head_sha && this.run.repository) {
      const shortSha = this.run.head_sha.substring(0, 7);
      const commitUrl = `${this.run.repository.html_url}/commit/${this.run.head_sha}`;
      const commitLink = `[${shortSha}](${commitUrl})`;
      parts.push(`**Commit:** \`${commitLink}\``);
    } else if (this.run.head_sha) {
      const shortSha = this.run.head_sha.substring(0, 7);
      parts.push(`**Commit:** \`${shortSha}\``);
    }

    // Repository Information with link
    if (this.run.repository?.html_url) {
      const repoLink = `[${this.run.repository.full_name}](${this.run.repository.html_url})`;
      parts.push(`**Repository:** ${repoLink}`);
    }

    // Conclusion details if available
    if (this.run.conclusion && this.run.conclusion !== "success") {
      parts.push(`**Conclusion:** ${this.run.conclusion.replace("_", " ")}`);
    }

    // Timestamps
    if (this.run.run_started_at && this.run.updated_at) {
      const startDate = new Date(this.run.run_started_at).toLocaleString();
      parts.push(`**Started:** ${startDate}`);
    }

    parts.push("---");
    parts.push("ID: `" + this.run.id + "`");

    const markdownString = parts.join("\n\n");

    return new vscode.MarkdownString(markdownString);
  }

  private static _getLabel(run: WorkflowRun): string {
    return run.name || "Run " + run.id;
  }
  private static _getDescription(run: WorkflowRun): string {
    const attempt = run.run_attempt || 1;
    const description = `#${run.run_number}`;
    return attempt > 1 ? `${description} (Attempt #${attempt})` : description;
  }
}
