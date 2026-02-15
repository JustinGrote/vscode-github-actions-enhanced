import { Event, EventEmitter, Disposable } from "vscode";
import { GitHubRepoContext } from "../git/repository";
import { WorkflowRun } from "../model";
import { setTimeout } from "node:timers/promises";
import { logTrace } from "../log";

/** A store of workflow runs on a per repo context **/
const runStoreMap: Map<GitHubRepoContext, RunStore> = new Map();

type RunId = WorkflowRun["id"];

export const getOrCreateRunStore = (gitHubRepoContext: GitHubRepoContext): RunStore => {
  let store = runStoreMap.get(gitHubRepoContext);
  if (!store) {
    store = new RunStore(gitHubRepoContext);
    runStoreMap.set(gitHubRepoContext, store);
  }
  return store;
};

/** Background fetches runs and updates them appropriately */
class RunStore implements Disposable {
  private readonly runs: Map<RunId, WorkflowRun> = new Map();
  protected disposed = false;


  // We use this to block any read actions until at least one sync cycle has completed
  private completeFirstSync: (() => void) | undefined;

  /** Await this event before making a list request */
  public readonly firstSyncCompletedPromise: Promise<void> = new Promise((resolve) => {
    this.completeFirstSync = resolve;
  });

  /** Fires with the workflow run ids that were added/updated in the store. We only send the ids of the runs so that the consumer has to refetch, and if they receive undefined they know the run was deleted. */
  private readonly _onDidUpdate = new EventEmitter<RunId[]>();
  public readonly onDidUpdate: Event<RunId[]> = this._onDidUpdate.event;

  constructor(public readonly gitHubRepoContext: GitHubRepoContext) {}

  async list(): Promise<WorkflowRun[]> {
    this.sync();
    await this.firstSyncCompletedPromise;
    return Array.from(this.runs.values());
  }

  async get(id: RunId): Promise<WorkflowRun | undefined> {
    this.sync();
    await this.firstSyncCompletedPromise;
    return this.runs.get(id);
  }

  /**
   * Polls workflow runs for this repo and emits when new/updated runs are observed.
   * Returns a disposable stopper.
   */
  private syncHandle: Disposable | undefined;

  sync(branchName?: string, requestInterval = 5000): { dispose(): void } {
    logTrace(`🔄️ Sync triggered!`)
    // Keep as singleton
    if (this.syncHandle) return this.syncHandle;
    logTrace(`⭐ Sync is Net New!`)

    const cacheHitRetryIntervalMs = 1000;

    const poll = async () => {
      while (true) {
        const client = this.gitHubRepoContext.client;
        logTrace(`📄 Polling workflow runs for ${this.gitHubRepoContext.owner}/${this.gitHubRepoContext.name} branch: ${branchName ?? "all branches"}`);

        const startTime = Date.now();
        const response = await client.conditionalRequest(
          client.actions.listWorkflowRunsForRepo,
          {
            owner: this.gitHubRepoContext.owner,
            repo: this.gitHubRepoContext.name,
            branch: branchName,
            per_page: 100
          }
        );

        if (!response) {
          logTrace(`Cache hit for workflow runs of ${this.gitHubRepoContext.owner}/${this.gitHubRepoContext.name} branch: ${branchName ?? "all branches"}`);
          const elapsedMs = Date.now() - startTime;
          const sleepMs = Math.max(0, cacheHitRetryIntervalMs - elapsedMs);
          await setTimeout(sleepMs);
        } else {
          // Process the response
          const runs = response.data;
          const newOrUpdatedRuns: WorkflowRun[] = [];

          for (const run of runs.workflow_runs) {
            const existingRun = this.runs.get(run.id);
            if (!existingRun || existingRun.updated_at !== run.updated_at) {
              this.runs.set(run.id, run);
              newOrUpdatedRuns.push(run);
            }
          }

          if (this.completeFirstSync) {
            logTrace(`Resolving first sync with ${newOrUpdatedRuns.length} runs for ${this.gitHubRepoContext.owner}/${this.gitHubRepoContext.name} branch: ${branchName ?? "all branches"}`);
            this.completeFirstSync();
            this.completeFirstSync = undefined;
          } else {
            if (newOrUpdatedRuns.length > 0) {
                // only fire emitter after first sync so that only changes emitted
                const crudRunIds = newOrUpdatedRuns.map(r => r.id);
                logTrace(`🚀 Emitting update for runs: ${crudRunIds}`);
                this._onDidUpdate.fire(crudRunIds);
            }
          }


          // Wait longer before the next poll
          await setTimeout(requestInterval);
        }
      }
    };

    // Start polling in the background
    void poll();

    this.syncHandle = {
      dispose: () => {
        this.disposed = true;
        this.syncHandle = undefined;
      },
    };

    return this.syncHandle;
  }

  dispose(): void {
    this._onDidUpdate.dispose();
    runStoreMap.delete(this.gitHubRepoContext);
    this.disposed = true;
  }
}

export abstract class WorkflowRunTreeDataProvider {


}
