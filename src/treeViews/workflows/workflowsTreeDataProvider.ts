import {match} from "ts-pattern"
import * as vscode from "vscode"

import {canReachGitHubAPI} from "../../api/canReachGitHubAPI"
import {getGitHubContext, GitHubRepoContext} from "../../git/repository"
import {log, logDebug, logError, logTrace} from "../../log"
import {Workflow} from "../../model"
import {createGithubCollection, GithubCollection} from "../collections/githubCollection"
import {REFRESH_TREE_ROOT} from "../currentBranch/currentBranchTreeDataProvider"
import {GithubActionTreeDataProvider} from "../githubActionTreeDataProvider"
import {AuthenticationNode} from "../shared/authenticationNode"
import {ErrorNode} from "../shared/errorNode"
import {GitHubAPIUnreachableNode} from "../shared/gitHubApiUnreachableNode"
import {NoGitHubRepositoryNode} from "../shared/noGitHubRepositoryNode"
import {NoWorkflowJobsNode} from "../shared/noWorkflowJobsNode"
import {WorkflowJobNode} from "../shared/workflowJobNode"
import {PreviousAttemptsNode, WorkflowRunAttemptNode, WorkflowRunNode} from "../shared/workflowRunNode"
import {WorkflowStepNode} from "../shared/workflowStepNode"
import {WorkflowNode} from "./workflowNode"
import {WorkflowsRepoNode} from "./workflowsRepoNode"

type WorkflowsTreeNode =
  | AuthenticationNode
  | NoGitHubRepositoryNode
  | WorkflowNode
  | WorkflowRunNode
  | PreviousAttemptsNode
  | WorkflowRunAttemptNode
  | WorkflowJobNode
  | NoWorkflowJobsNode
  | WorkflowStepNode
  | GitHubAPIUnreachableNode

export class WorkflowsTreeDataProvider extends GithubActionTreeDataProvider<WorkflowsTreeNode> {
  private workflowCollections: Map<string, GithubCollection<Workflow, {owner: string; repo: string}>> = new Map()
  private workflowChangeFeeds: Map<
    string,
    ReturnType<GithubCollection<Workflow, {owner: string; repo: string}>["subscribeChanges"]>
  > = new Map()
  private workflowNodes: Map<string, WorkflowNode> = new Map()

  protected _updateNode(node: WorkflowRunNode): void {
    logTrace(`Workflow Tree Node updated: ${node.description} ${node.label}`)
    this._onDidChangeTreeData.fire(node)
  }

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      this._onDidChangeTreeData.fire(REFRESH_TREE_ROOT)
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API")
    }
  }

  async getChildren(element?: WorkflowsTreeNode): Promise<WorkflowsTreeNode[]> {
    const children = await super.getChildren(element)
    if (children) return children

    // Root Refresh
    logDebug("🌲 Tree Root Request for Workflows")

    try {
      const gitHubContext = await getGitHubContext()
      if (!gitHubContext) {
        logDebug("could not get github context for workflows")
        return [new GitHubAPIUnreachableNode()]
      }

      if (gitHubContext.repos.length > 0) {
        // Special case, if there is only one repo, return workflow nodes directly
        if (gitHubContext.repos.length == 1) {
          return await this.getWorkflowNodes(gitHubContext.repos[0])
        }

        return gitHubContext.repos.map(r => new WorkflowsRepoNode(r, this))
      }

      log("No GitHub repositories found")
      return []
    } catch (e) {
      logError(e as Error, "Failed to get GitHub context")

      if (`${(e as Error).message}`.startsWith("Could not get token from the GitHub authentication provider.")) {
        return [new AuthenticationNode()]
      }

      return [new ErrorNode(`An error has occurred: ${(e as Error).message}`)]
    }
  }

  async getWorkflowNodes(gitHubRepoContext: GitHubRepoContext): Promise<WorkflowNode[]> {
    logDebug(`Getting workflow nodes for repo ${gitHubRepoContext.name}`)

    const client = gitHubRepoContext.client
    const collectionKey = `${gitHubRepoContext.owner}/${gitHubRepoContext.name}`
    const queryKey = ["workflows", gitHubRepoContext.owner, gitHubRepoContext.name]

    let collection = this.workflowCollections.get(collectionKey)
    if (!collection) {
      logDebug(`Creating workflow collection for repo ${gitHubRepoContext.name}`)
      collection = createGithubCollection(
        queryKey,
        client,
        client.actions.listRepoWorkflows,
        {
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          per_page: 100,
        },
        response => response.data.workflows,
        (a, b) => a.name.localeCompare(b.name),
        "id",
      )
      this.workflowCollections.set(collectionKey, collection)
    }

    const workflows = await collection.toArrayWhenReady()

    // Subscribe for future changes after initial query
    let changeFeed = this.workflowChangeFeeds.get(collectionKey)
    if (!changeFeed) {
      changeFeed = collection.subscribeChanges(changes => {
        logDebug(`🚨 Workflow changes detected for ${gitHubRepoContext.name}`)

        const nodesToRefresh = changes
          .map(change => {
            logTrace(`🚨 Workflow change detected: ${change.type} ${change.value.id} ${change.value.name}`)
            return match(change)
              .with({type: "update"}, () => {
                log(`✏️ Workflow ${change.value.id} was updated`)
                return this.toWorkflowNode(change.value, gitHubRepoContext)
              })
              .with({type: "insert"}, () => {
                log(`➕ Workflow ${change.value.id} was inserted`)
                return this.toWorkflowNode(change.value, gitHubRepoContext)
              })
              .with({type: "delete"}, () => {
                log(`🗑️ Workflow ${change.value.id} was deleted`)
                this.workflowNodes.delete(change.value.id.toString())
                return undefined
              })
              .exhaustive()
          })
          .filter(node => node !== undefined)

        if (nodesToRefresh.length > 0) {
          this._onDidChangeTreeData.fire(nodesToRefresh)
        }
      })

      this.workflowChangeFeeds.set(collectionKey, changeFeed)
      logDebug(`👁️ Watcher for workflows created for repo ${gitHubRepoContext.name}`)
    }

    return workflows.map(wf => this.toWorkflowNode(wf, gitHubRepoContext))
  }

  private toWorkflowNode(workflow: Workflow, gitHubRepoContext: GitHubRepoContext): WorkflowNode {
    const existingNode = this.workflowNodes.get(workflow.id.toString())
    if (existingNode) {
      logTrace(`🖊️ Workflow ${workflow.id} already exists in tree, reusing existing node and updating its data`)
      existingNode.updateWorkflow(workflow)
      return existingNode
    }

    const nameWithoutNewlines = workflow.name.replace(/(\r\n|\n|\r)/gm, " ")
    workflow.name = nameWithoutNewlines

    const node = new WorkflowNode(gitHubRepoContext, workflow)
    this.workflowNodes.set(workflow.id.toString(), node)
    return node
  }
}
