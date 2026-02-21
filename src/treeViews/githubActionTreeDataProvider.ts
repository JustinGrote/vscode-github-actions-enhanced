import * as vscode from "vscode"

import { logTrace } from "~/log"

import { REFRESH_TREE_ROOT } from "./currentBranch/currentBranchTreeDataProvider"

/** All tree nodes should optionally implement getChildren. The provider will delegate the appropriate resolution to the node. If they do not, they are considered to be leafs and will not be expanded **/
export abstract class GithubActionTreeNode extends vscode.TreeItem {
  getChildren(): vscode.ProviderResult<GithubActionTreeNode[]> {
    return []
  }

  /** Calculate the time a run, job, or step took to run. If completed_at is not specified, return duration to the current time */
  protected getNodeDuration({
    started_at,
    completed_at,
  }: {
    started_at?: string | null
    completed_at?: string | null
  }): string | undefined {
    if (!started_at) return undefined
    const started = new Date(started_at)
    const completed = completed_at ? new Date(completed_at) : new Date()
    return this.getHumanizedDuration(started, completed)
  }

  protected getHumanizedDuration(started: Date, completed: Date = new Date()): string | undefined {
    const diffMs = Math.max(0, completed.getTime() - started.getTime())
    const diffSeconds = Math.floor(diffMs / 1000)

    let remaining = diffSeconds
    const hours = Math.floor(remaining / 3600)
    remaining %= 3600
    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60

    const parts: string[] = []
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (seconds > 0) parts.push(`${seconds}s`)

    return parts.slice(0, 2).join(" ") || "0s"
  }
}

/** Provides the base infrastructure for interfacing the Github Actions API to the vscode tree view */
export abstract class GithubActionTreeDataProvider<
  T extends GithubActionTreeNode,
> implements vscode.TreeDataProvider<T> {
  constructor() {}
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | T[] | typeof REFRESH_TREE_ROOT>()
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  protected readonly onDidChangeTreeDataTrace = this.onDidChangeTreeData((e) => {
    if (e === REFRESH_TREE_ROOT) {
      logTrace(`👉 VSCode informed to refresh full tree`)
    } else if (Array.isArray(e)) {
      logTrace(`👉 VSCode informed to refresh tree nodes: ${e.map((n) => n.id).join(", ")}`)
    } else {
      logTrace(`👉 VSCode informed to refresh tree node ${e.id} ${e.label}`)
    }
  })

  async getTreeItem(element: T) {
    logTrace(
      `🧑‍💻 vscode called getTreeItem for ${element.constructor.name}: ${element.label} ${element.description} [${element.id}]`,
    )
    return element
  }

  async getChildren(element?: T): Promise<T[] | typeof REFRESH_TREE_ROOT> {
    const elementDescription = element
      ? `${element.constructor.name}: ${element.label} ${element.description} [${element.id}]`
      : "🌲 Root"
    logTrace(`🧑‍💻 vscode called getChildren for ${elementDescription}`)

    if (!element) return REFRESH_TREE_ROOT

    if (element.getChildren) return element.getChildren() as Promise<T[]>

    // If no getChildren method, return empty to signal it's a leaf. It should have been created as not expandable anyways. TODO: type check this?
    return []
  }
}
