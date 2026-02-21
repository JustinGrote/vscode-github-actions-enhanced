import * as vscode from "vscode"

import {GithubActionTreeNode} from "../githubActionTreeDataProvider"

/**
 * When no github.com remote can be found in the current workspace.
 */
export class NoWorkflowJobsNode extends GithubActionTreeNode {
  constructor() {
    super("No workflow jobs")
  }
  getChildren() {
    return []
  }
}
