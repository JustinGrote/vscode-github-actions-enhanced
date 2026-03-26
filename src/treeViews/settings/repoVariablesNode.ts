import * as vscode from "vscode"

import { GitHubRepoContext } from "~/git/repository"
import { reportException } from "~/log"

import { EmptyNode } from "./emptyNode"
import { VariableNode } from "./variableNode"

export type RepoVariablesCommandArgs = Pick<RepoVariablesNode, "gitHubRepoContext">

export class RepoVariablesNode extends vscode.TreeItem {
  constructor(public readonly gitHubRepoContext: GitHubRepoContext) {
    super("Repository Variables", vscode.TreeItemCollapsibleState.Collapsed)

    this.contextValue = "repo-variables"
  }

  async getVariables(): Promise<vscode.TreeItem[]> {
    let variables: VariableNode[] = []
    try {
      variables = await this.gitHubRepoContext.client.paginate(
        this.gitHubRepoContext.client.actions.listRepoVariables,
        {
          owner: this.gitHubRepoContext.owner,
          repo: this.gitHubRepoContext.name,
          per_page: 30,
        },
        (response) => response.data.map((s) => new VariableNode(this.gitHubRepoContext, s)),
      )
    } catch (e) {
      reportException(e, "Error fetching repository variables")
    }

    if (!variables || variables.length === 0) {
      return [new EmptyNode("No repository variables defined")]
    }

    return variables
  }
}
