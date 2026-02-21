import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"

import { OrgSecretsNode } from "./orgSecretsNode"
import { RepoSecretsNode } from "./repoSecretsNode"

export class SecretsNode extends vscode.TreeItem {
  constructor(public readonly gitHubRepoContext: GitHubRepoContext) {
    super("Secrets", vscode.TreeItemCollapsibleState.Collapsed)

    this.iconPath = new vscode.ThemeIcon("lock")
  }

  get nodes(): (RepoSecretsNode | OrgSecretsNode)[] {
    if (this.gitHubRepoContext.organizationOwned) {
      return [new RepoSecretsNode(this.gitHubRepoContext), new OrgSecretsNode(this.gitHubRepoContext)]
    }

    return [new RepoSecretsNode(this.gitHubRepoContext)]
  }
}
