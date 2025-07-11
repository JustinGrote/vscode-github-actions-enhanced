import {EventEmitter} from "vscode";
import {GitHubRepoContext} from "../git/repository";
import {logDebug} from "../log";
import * as model from "../model";
import {WorkflowRun} from "./workflowRun";

export interface RunStoreEvent {
  run: WorkflowRun;
}

type Updater = {
  intervalMs: number;
  remainingAttempts: number;
  repoContext: GitHubRepoContext;
  runId: number;
  handle: NodeJS.Timeout | undefined;
};

/**
 * Serves as the central cache store for Workflow run status in Github Actions.
 *
 * This is basically a local mirror of what is fetched from the GitHub API.
 *
 * Views should subscribe to this store's event to get updates
 */
export class RunStore extends EventEmitter<RunStoreEvent> {
  private runs = new Map<number, WorkflowRun>();
  private updaters = new Map<number, Updater>();

  getRun(runId: number): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  addRun(gitHubRepoContext: GitHubRepoContext, runData: model.WorkflowRun): WorkflowRun {
    let run = this.runs.get(runData.id);
    if (!run) {
      run = new WorkflowRun(gitHubRepoContext, runData);

      logDebug("[Store]: adding run: ", runData.id, runData.updated_at);
    } else {
      run.updateRun(runData);

      logDebug("[Store]: updating run: ", runData.id, runData.updated_at);
    }

    this.runs.set(runData.id, run);
    this.fire({run});
    return run;
  }

  /**
   * Start polling for updates for the given run
   */
  pollRun(runId: number, repoContext: GitHubRepoContext, intervalMs: number, attempts = 10) {
    const existingUpdater: Updater | undefined = this.updaters.get(runId);
    if (existingUpdater && existingUpdater.handle) {
      clearInterval(existingUpdater.handle);
    }

    const updater: Updater = {
      intervalMs,
      repoContext,
      runId,
      remainingAttempts: attempts,
      handle: undefined
    };

    updater.handle = setInterval(() => void this.fetchRun(updater), intervalMs);

    this.updaters.set(runId, updater);
  }

  pollRunUntilComplete(runId: number, repoContext: GitHubRepoContext) {
    const existingUpdater: Updater | undefined = this.updaters.get(runId);
    if (existingUpdater && existingUpdater.handle) {
      clearInterval(existingUpdater.handle);
    }

    const updater: Updater = {
      intervalMs: 1000,
      repoContext,
      runId,
      remainingAttempts: 20,
      handle: undefined
    };

    updater.handle = setInterval(() => void this.fetchRun(updater), updater.intervalMs);

    this.updaters.set(runId, updater);
  }

  private async fetchRun(updater: Updater) {
    const client = updater.repoContext.client;
    logDebug("Updating run: ", updater.runId);

    updater.remainingAttempts--;
    if (updater.remainingAttempts === 0) {
      if (updater.handle) {
        clearInterval(updater.handle);
      }

      this.updaters.delete(updater.runId);
    }

    const result = await client.conditionalRequest(
      client.actions.getWorkflowRun,
      {
        owner: updater.repoContext.owner,
        repo: updater.repoContext.name,
        run_id: updater.runId
      },
      `getWorkflowRun-${updater.runId}`
    );

    if (result === undefined) {
      // No changes, do nothing
      return;
    }

    const run = result.data;
    this.addRun(updater.repoContext, run);
  }
}
