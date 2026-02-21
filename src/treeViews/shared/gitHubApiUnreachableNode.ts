import * as vscode from "vscode"

import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

/**
 * Shown when no calls to the github API can be made.
 */
export class GitHubAPIUnreachableNode extends GithubActionTreeNode {
  constructor() {
    super("Cannot reach GitHub API")
    this.iconPath = new vscode.ThemeIcon("notebook-state-error")
  }
}
