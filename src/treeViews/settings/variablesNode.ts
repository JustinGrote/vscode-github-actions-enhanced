import * as vscode from "vscode"

import {GitHubRepoContext} from "../../git/repository"
import {OrgVariablesNode} from "./orgVariablesNode"
import {RepoVariablesNode} from "./repoVariablesNode"

export class VariablesNode extends vscode.TreeItem {
  constructor(public readonly gitHubRepoContext: GitHubRepoContext) {
    super("Variables", vscode.TreeItemCollapsibleState.Collapsed)

    this.iconPath = new vscode.ThemeIcon("symbol-text")
  }

  get nodes(): (RepoVariablesNode | OrgVariablesNode)[] {
    if (this.gitHubRepoContext.organizationOwned) {
      return [new RepoVariablesNode(this.gitHubRepoContext), new OrgVariablesNode(this.gitHubRepoContext)]
    }
    return [new RepoVariablesNode(this.gitHubRepoContext)]
  }
}
