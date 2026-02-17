import * as vscode from "vscode";

import { GitHubRepoContext } from "../../git/repository";
import { GithubActionTreeNode } from "../githubActionTreeDataProvider";
import { WorkflowNode } from "./workflowNode";
import type { WorkflowsTreeDataProvider } from "./workflowsTreeDataProvider";

export class WorkflowsRepoNode extends GithubActionTreeNode {
  constructor(
    public readonly gitHubRepoContext: GitHubRepoContext,
    private treeDataProvider: WorkflowsTreeDataProvider
  ) {
    super(gitHubRepoContext.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = "wf-repo";
  }

  async getChildren(): Promise<WorkflowNode[]> {
    return await this.treeDataProvider.getWorkflowNodes(this.gitHubRepoContext);
  }
}
