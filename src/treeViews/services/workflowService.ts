import { cp } from "fs"

import {
  Collection,
  createLiveQueryCollection,
  eq,
  type Context,
  type InitialQueryBuilder,
  type QueryBuilder,
} from "@tanstack/db"
import { match } from "ts-pattern"
import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { log, logDebug, logTrace, logWarn } from "~/log"
import { WorkflowJob, WorkflowRun, WorkflowRunAttempt } from "~/model"
import { createGithubCollection, GithubCollection } from "~/treeViews/collections/githubCollection"

export interface WorkflowRunCollectionKey {
  owner: string
  repo: string
}

export interface WorkflowJobCollectionKey {
  owner: string
  repo: string
  runId: number
  attemptNumber: number
}

/**
 * Service class that manages workflow run and job collections across the application.
 * Provides a centralized source of truth for workflow data that can be filtered and queried.
 */
export class WorkflowService {
  private static instance: WorkflowService | undefined

  // Workflow run collections - one per repo, fetches all runs
  private workflowRunCollections: Map<string, GithubCollection<WorkflowRun, { owner: string; repo: string }>> =
    new Map()
  private workflowRunChangeFeeds: Map<
    string,
    ReturnType<GithubCollection<WorkflowRun, { owner: string; repo: string }>["subscribeChanges"]>
  > = new Map()

  // Job collections - one per run/attempt
  private workflowJobCollections: Map<string, GithubCollection<WorkflowJob, { runId: number }>> = new Map()
  private workflowJobChangeFeeds: Map<
    string,
    ReturnType<GithubCollection<WorkflowJob, { runId: number }>["subscribeChanges"]>
  > = new Map()

  static getInstance(): WorkflowService {
    if (!WorkflowService.instance) {
      WorkflowService.instance = new WorkflowService()
    }
    return WorkflowService.instance
  }

  /**
   * Get workflow run collection for a repository. Creates the collection if it doesn't exist.
   */
  async getWorkflowRunCollection(
    gitHubRepoContext: GitHubRepoContext,
  ): Promise<GithubCollection<WorkflowRun, { owner: string; repo: string }>> {
    const collectionKey = this.getRepoKey(gitHubRepoContext)

    let collection = this.workflowRunCollections.get(collectionKey)
    if (!collection) {
      logDebug(`Creating workflow run collection for repo ${gitHubRepoContext.name}`)

      const queryKey = ["workflowRunsForRepo", gitHubRepoContext.owner, gitHubRepoContext.name]
      collection = createGithubCollection(
        queryKey,
        gitHubRepoContext.client,
        gitHubRepoContext.client.actions.listWorkflowRunsForRepo,
        {
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          per_page: 30,
        },
        (response) => response.data.workflow_runs,
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        "id",
      )

      this.workflowRunCollections.set(collectionKey, collection)
      logDebug(`✅ Created workflow run collection for ${gitHubRepoContext.name}`)
    }

    return collection
  }

  /**
   * Get jobs for a specific workflow run attempt.
   */
  async getWorkflowRunJobs(
    gitHubRepoContext: GitHubRepoContext,
    workflowRun: WorkflowRun | WorkflowRunAttempt,
  ): Promise<WorkflowJob[]> {
    const { id: runId, run_attempt: attemptNumber = 1 } = workflowRun
    const queryKey: string[] = [
      "jobs",
      gitHubRepoContext.owner,
      gitHubRepoContext.name,
      String(runId),
      String(attemptNumber),
    ]
    const collectionKey = this.getJobCollectionKey(gitHubRepoContext, runId, attemptNumber)
    let collection = this.workflowJobCollections.get(collectionKey)

    if (!collection) {
      let loggedRunCompleted = false
      collection = createGithubCollection(
        queryKey,
        gitHubRepoContext.client,
        gitHubRepoContext.client.actions.listJobsForWorkflowRunAttempt,
        {
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          run_id: runId,
          attempt_number: attemptNumber,
          per_page: 30,
        },
        (response) => response.data.jobs,
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        "id",
        // Stop polling if the workflow run is concluded
        () => {
          if (!workflowRun.conclusion) return 500
          if (!loggedRunCompleted) {
            logTrace(`✅ Workflow run ${runId} attempt ${attemptNumber} is concluded, stopping job collection polling`)
            loggedRunCompleted = true
          }
          return false
        },
      )

      this.workflowJobCollections.set(collectionKey, collection)
    }

    return collection.toArrayWhenReady()
  }

  async getWorkflowRunAttempt(
    githubRepoContext: GitHubRepoContext,
    runId: number,
    attemptNumber: number,
  ): Promise<WorkflowRunAttempt> {
    const response = await githubRepoContext.client.actions.getWorkflowRunAttempt({
      owner: githubRepoContext.owner,
      repo: githubRepoContext.name,
      run_id: runId,
      attempt_number: attemptNumber,
      exclude_pull_requests: true,
    })
    return response.data
  }

  /**
   * Subscribe to job changes for a specific workflow run attempt.
   */
  async subscribeToJobChanges(
    gitHubRepoContext: GitHubRepoContext,
    workflowRun: WorkflowRun | WorkflowRunAttempt,
    callback: (changes: Array<{ type: "insert" | "update" | "delete"; value: WorkflowJob }>) => void,
  ): Promise<{ unsubscribe: () => void }> {
    const { id: runId, run_attempt: attemptNumber = 1 } = workflowRun
    const collectionKey = this.getJobCollectionKey(gitHubRepoContext, runId, attemptNumber)
    // Wait for first sync before subscribing, we only want delta changes
    await this.getWorkflowRunJobs(gitHubRepoContext, workflowRun)

    const collection = this.workflowJobCollections.get(collectionKey)
    if (!collection) {
      log(`⚠️ Could not find job collection for run ${runId} attempt ${attemptNumber}, cannot subscribe to job changes`)
      return {
        unsubscribe: () => {
          // no-op if collection doesn't exist
        },
      }
    }

    const feed = collection.subscribeChanges((changes) => {
      logTrace(`🚨 Job changes detected for run ${runId} attempt ${attemptNumber}: ${changes.length} changes`)
      callback(
        changes.map((change) =>
          match(change)
            .with({ type: "update" }, (c) => ({ type: "update" as const, value: c.value }))
            .with({ type: "insert" }, (c) => ({ type: "insert" as const, value: c.value }))
            .with({ type: "delete" }, (c) => ({ type: "delete" as const, value: c.value }))
            .exhaustive(),
        ),
      )
    })

    this.workflowJobChangeFeeds.set(collectionKey, feed)

    return {
      unsubscribe: () => {
        const feed = this.workflowJobChangeFeeds.get(collectionKey)
        if (feed) {
          feed.unsubscribe()
          this.workflowJobChangeFeeds.delete(collectionKey)
        }
      },
    }
  }

  private getRepoKey(gitHubRepoContext: GitHubRepoContext): string {
    return `${gitHubRepoContext.owner}/${gitHubRepoContext.name}`
  }

  private getJobCollectionKey(gitHubRepoContext: GitHubRepoContext, runId: number, attemptNumber: number): string {
    return `${this.getRepoKey(gitHubRepoContext)}/${runId}/${attemptNumber}`
  }
}

export class WorkflowRunView {
  private static views: Map<string, WorkflowRunView> = new Map()
  private query: Collection<WorkflowRun>
  /** Use the async create factory **/
  private constructor(query: Collection<WorkflowRun>) {
    this.query = query
  }

  public static async create(githubRepoContext: GitHubRepoContext, branchName?: string): Promise<WorkflowRunView> {
    const viewKey = `${githubRepoContext.owner}/${githubRepoContext.name}/${branchName ?? ""}`
    const existingView = this.views.get(viewKey)
    if (existingView) return existingView

    const workflowService = WorkflowService.getInstance()
    const collection = await workflowService.getWorkflowRunCollection(githubRepoContext)
    const query = createLiveQueryCollection((q) =>
      q.from({ run: collection }).where(({ run }) => (branchName ? eq(run.head_branch, branchName) : eq(true, true))),
    )
    const view = new WorkflowRunView(query)
    this.views.set(viewKey, view)
    return view
  }

  public async get(): Promise<WorkflowRun[]> {
    return this.query.toArrayWhenReady()
  }

  public subscribe(
    callback: (changes: Array<{ type: "insert" | "update" | "delete"; value: WorkflowRun }>) => void,
    once = false,
  ): vscode.Disposable {
    const feed = this.query.subscribeChanges((changes) => {
      logTrace(`🚨 WorkflowRunView changes detected: ${changes.length} changes`)
      callback(
        changes.map((change) =>
          match(change)
            .with({ type: "update" }, (c) => ({ type: "update" as const, value: c.value }))
            .with({ type: "insert" }, (c) => ({ type: "insert" as const, value: c.value }))
            .with({ type: "delete" }, (c) => ({ type: "delete" as const, value: c.value }))
            .exhaustive(),
        ),
      )
      if (once) feed.unsubscribe()
    })

    return {
      dispose: () => feed.unsubscribe(),
    }
  }
}
