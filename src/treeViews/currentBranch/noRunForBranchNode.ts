import * as vscode from "vscode"

import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

export class NoRunForBranchNode extends GithubActionTreeNode {
  constructor() {
    super("No runs for current branch")
  }
}
