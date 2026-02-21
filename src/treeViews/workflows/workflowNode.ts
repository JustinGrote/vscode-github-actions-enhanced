import {match} from "ts-pattern"
import * as vscode from "vscode"

import {getPinnedWorkflows} from "../../configuration/configuration"
import {GitHubRepoContext} from "../../git/repository"
import {logDebug, log, logTrace} from "../../log"
import {Workflow, WorkflowRun} from "../../model"
import {getWorkflowUri} from "../../workflow/workflow"
import {createGithubCollection, GithubCollection} from "../collections/githubCollection"
import {GithubActionTreeNode} from "../githubActionTreeDataProvider"
import {WorkflowRunNode} from "../shared/workflowRunNode"

export class WorkflowNode extends GithubActionTreeNode {
  private workflowRunCollection: GithubCollection<WorkflowRun, {workflow_id: string | number}> | undefined
  private workflowRunChangeFeed:
    | ReturnType<GithubCollection<WorkflowRun, {workflow_id: string | number}>["subscribeChanges"]>
    | undefined
  private workflowRunNodes: Map<string, WorkflowRunNode> = new Map()

  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public wf: Workflow,
    public readonly workflowContext?: string,
  ) {
    super(wf.name, vscode.TreeItemCollapsibleState.Collapsed)

    this.updateContextValue()
  }

  updateWorkflow(workflow: Workflow): void {
    this.wf = workflow
    this.label = workflow.name
    this.updateContextValue()
  }

  async getChildren(): Promise<WorkflowRunNode[]> {
    logDebug(`Getting workflow runs for workflow ${this.wf.name} (${this.wf.id})`)

    const client = this.gitHubRepoContext.client
    const queryKey = ["workflowRuns", this.gitHubRepoContext.owner, this.gitHubRepoContext.name, this.wf.id.toString()]

    if (!this.workflowRunCollection) {
      logDebug(`Creating workflow run collection for workflow ${this.wf.name}`)
      this.workflowRunCollection = createGithubCollection(
        queryKey,
        client,
        client.actions.listWorkflowRuns,
        {
          owner: this.gitHubRepoContext.owner,
          repo: this.gitHubRepoContext.name,
          workflow_id: this.wf.id,
          per_page: 30,
        },
        response => response.data.workflow_runs,
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        "id",
      )
    }

    const runs = await this.workflowRunCollection.toArrayWhenReady()

    // Subscribe for future changes after initial query
    if (!this.workflowRunChangeFeed) {
      this.workflowRunChangeFeed = this.workflowRunCollection.subscribeChanges(changes => {
        logDebug(`🚨 Workflow runs change detected for ${this.wf.name}`)

        const nodesToRefresh = changes
          .map(change => {
            logTrace(
              `🚨 WorkflowRun change detected: ${change.type} ${change.value.id} ${change.value.name} #${change.value.run_number}`,
            )
            return match(change)
              .with({type: "update"}, () => {
                log(`✏️ Run ${change.value.id} was updated`)
                return this.toWorkflowRunNode(change.value)
              })
              .with({type: "insert"}, () => {
                log(`➕ Run ${change.value.id} was inserted`)
                return this.toWorkflowRunNode(change.value)
              })
              .with({type: "delete"}, () => {
                log(`🗑️ Run ${change.value.id} was deleted`)
                this.workflowRunNodes.delete(change.value.id.toString())
                return undefined
              })
              .exhaustive()
          })
          .filter(node => node !== undefined)

        // Notify tree of changes
        if (nodesToRefresh.length > 0) {
          // We would need access to the parent tree data provider to fire changes
          // For now, just log that changes were detected
          logTrace(`Found ${nodesToRefresh.length} nodes to refresh`)
        }
      })

      logDebug(`👁️ Watcher for workflow runs created for workflow ${this.wf.name}`)
    }

    return runs.map(run => this.toWorkflowRunNode(run))
  }

  private toWorkflowRunNode(run: WorkflowRun): WorkflowRunNode {
    const existingNode = this.workflowRunNodes.get(run.id.toString())
    if (existingNode) {
      logTrace(`🖊️ Run ${run.id} already exists in workflow node, reusing existing node and updating its data`)
      existingNode.updateRun(run)
      return existingNode
    }

    logTrace(`➕ Adding run ${run.id} ${run.name} #${run.run_number} to workflow node`)
    const workflowRunNode = new WorkflowRunNode(this.gitHubRepoContext, run)
    this.workflowRunNodes.set(run.id.toString(), workflowRunNode)
    return workflowRunNode
  }

  updateContextValue() {
    this.contextValue = "workflow"

    const workflowFullPath = getWorkflowUri(this.gitHubRepoContext, this.wf.path)
    if (workflowFullPath) {
      const relativeWorkflowPath = vscode.workspace.asRelativePath(workflowFullPath)
      if (new Set(getPinnedWorkflows()).has(relativeWorkflowPath)) {
        this.contextValue += " pinned"
      } else {
        this.contextValue += " pinnable"
      }
    }

    if (this.workflowContext) {
      this.contextValue += this.workflowContext
    }
  }
}
