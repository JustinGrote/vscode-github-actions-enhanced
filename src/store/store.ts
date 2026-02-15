import {EventEmitter} from "vscode";
import {GitHubRepoContext} from "../git/repository";
import {logDebug} from "../log";
import * as model from "../model";
import {WorkflowRun} from "./workflowRun";

export interface RunStoreEvent {
  run: WorkflowRun;
}
/**
 * Serves as the central cache store for Workflow run status in Github Actions.
 *
 * NOTE: Run attempts are basically identical to runs so we don't bother to store them separately.
 */

export class RunStore extends EventEmitter<RunStoreEvent> {
  private runs = new Map<number, WorkflowRun>();

  getRun(runId: number): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  private addRun(gitHubRepoContext: GitHubRepoContext, runData: model.WorkflowRun): void {
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
  }
}
