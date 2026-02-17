import * as vscode from "vscode";
import { REFRESH_TREE_ROOT } from "./currentBranch/currentBranchTreeDataProvider";
import { logTrace } from "../log";
import { createLiveQueryCollection } from "@tanstack/db";

/** All tree nodes should optionally implement getChildren. The provider will delegate the appropriate resolution to the node. If they do not, they are considered to be leafs and will not be expanded **/
export abstract class GithubActionTreeNode extends vscode.TreeItem {
	getChildren(): vscode.ProviderResult<GithubActionTreeNode[]> {return []}
}

/** Provides the base infrastructure for interfacing the Github Actions API to the vscode tree view */
export abstract class GithubActionTreeDataProvider<T extends GithubActionTreeNode> implements vscode.TreeDataProvider<T> {
	constructor() {}
	protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | T[] | typeof REFRESH_TREE_ROOT>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	protected readonly onDidChangeTreeDataTrace = this.onDidChangeTreeData((e) => {
		if (e === REFRESH_TREE_ROOT) {
			logTrace(`👉 VSCode informed to refresh full tree`);
		} else if (Array.isArray(e)) {
			logTrace(`👉 VSCode informed to refresh tree nodes: ${e.map(n => n.id).join(", ")}`);
		}
		else {
			logTrace(`👉 VSCode informed to refresh tree node ${e.id} ${e.label}`);
		}
	});

	async getTreeItem(element: T) {
		logTrace(`🧑‍💻 vscode called getTreeItem for ${element.constructor.name}: ${element.label} ${element.description} [${element.id}]`);
		return element
	}

	async getChildren(element?: T): Promise<T[] | typeof REFRESH_TREE_ROOT> {
		const elementDescription = element ? `${element.constructor.name}: ${element.label} ${element.description} [${element.id}]` : "🌲 Root"
    logTrace(`🧑‍💻 vscode called getChildren for ${elementDescription}`);

		if (!element) return REFRESH_TREE_ROOT

		if (element.getChildren) return element.getChildren() as Promise<T[]>

		// If no getChildren method, return empty to signal it's a leaf. It should have been created as not expandable anyways. TODO: type check this?
		return []
	}
}