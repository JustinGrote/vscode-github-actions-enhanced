import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { WorkflowRun } from "~/model"
import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

export type PendingApprovalCommandArgs = Pick<PendingApprovalNode, "gitHubRepoContext" | "run">

export class PendingApprovalNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    public readonly run: WorkflowRun,
  ) {
    super("Pending Maintainer Approval")
    this.contextValue = "pending-approval"
    this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("testing.iconQueued"))
    this.checkboxState = vscode.TreeItemCheckboxState.Unchecked
    this.tooltip = new vscode.MarkdownString(
      "This workflow run is waiting for maintainer approval. " +
        "Check the checkbox or right-click and select **Approve workflow run** to approve.",
    )
  }
}
