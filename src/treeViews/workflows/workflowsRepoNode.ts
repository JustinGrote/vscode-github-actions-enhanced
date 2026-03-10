import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

/** When multiple repos are present, this node is presented */
export class WorkflowsRepoNode extends GithubActionTreeNode {
  constructor(public readonly gitHubRepoContext: GitHubRepoContext) {
    super(gitHubRepoContext.name, vscode.TreeItemCollapsibleState.Collapsed)
    this.contextValue = "wf-repo"
    this.iconPath = new vscode.ThemeIcon("repo")
  }
}
