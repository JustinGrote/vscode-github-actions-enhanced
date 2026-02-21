import * as vscode from "vscode"

import {GithubActionTreeNode} from "../githubActionTreeDataProvider"

/**
 * When no github.com remote can be found in the current workspace.
 */
export class NoGitHubRepositoryNode extends GithubActionTreeNode {
  constructor() {
    super("Did not find a github.com repository")
  }
}
