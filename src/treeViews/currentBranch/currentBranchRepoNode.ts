import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

export class CurrentBranchRepoNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly currentBranchName: string,
  ) {
    super(gitHubRepoContext.name, vscode.TreeItemCollapsibleState.Collapsed)

    this.description = currentBranchName
    this.contextValue = "cb-repo"
  }
}
