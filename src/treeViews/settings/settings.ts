import * as vscode from "vscode"

import {canReachGitHubAPI} from "../../api/canReachGitHubAPI"
import {getGitHubContext} from "../../git/repository"
import {GitHubAPIUnreachableNode} from "../shared/gitHubApiUnreachableNode"
import {EnvironmentNode} from "./environmentNode"
import {EnvironmentSecretsNode} from "./environmentSecretsNode"
import {EnvironmentsNode} from "./environmentsNode"
import {EnvironmentVariablesNode} from "./environmentVariablesNode"
import {OrgSecretsNode} from "./orgSecretsNode"
import {OrgVariablesNode} from "./orgVariablesNode"
import {RepoSecretsNode} from "./repoSecretsNode"
import {RepoVariablesNode} from "./repoVariablesNode"
import {SecretsNode} from "./secretsNode"
import {SettingsRepoNode, getSettingNodes} from "./settingsRepoNode"
import {SettingsExplorerNode} from "./types"
import {VariablesNode} from "./variablesNode"

export class SettingsTreeProvider implements vscode.TreeDataProvider<SettingsExplorerNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SettingsExplorerNode | null>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  async refresh(): Promise<void> {
    // Don't delete all the nodes if we can't reach GitHub API
    if (await canReachGitHubAPI()) {
      this._onDidChangeTreeData.fire(null)
    } else {
      await vscode.window.showWarningMessage("Unable to refresh, could not reach GitHub API")
    }
  }

  getTreeItem(element: SettingsExplorerNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element
  }

  async getChildren(element?: SettingsExplorerNode | undefined): Promise<SettingsExplorerNode[]> {
    const gitHubContext = await getGitHubContext()
    if (!gitHubContext) {
      return [new GitHubAPIUnreachableNode()]
    }

    if (!element) {
      if (gitHubContext.repos.length > 0) {
        if (gitHubContext.repos.length == 1) {
          return getSettingNodes(gitHubContext.repos[0])
        }

        return gitHubContext.repos.map(r => new SettingsRepoNode(r))
      }
    }

    if (element instanceof SettingsRepoNode) {
      return element.getSettings()
    }

    //
    // Secrets
    //
    if (element instanceof SecretsNode) {
      return element.nodes
    }

    if (element instanceof RepoSecretsNode || element instanceof OrgSecretsNode) {
      return element.getSecrets()
    }

    //
    // Variables
    //
    if (element instanceof VariablesNode) {
      return element.nodes
    }

    if (element instanceof RepoVariablesNode || element instanceof OrgVariablesNode) {
      return element.getVariables()
    }

    //
    // Environments
    //

    if (element instanceof EnvironmentsNode) {
      return element.getEnvironments()
    }

    if (element instanceof EnvironmentNode) {
      return element.getNodes()
    }

    if (element instanceof EnvironmentSecretsNode) {
      return element.getSecrets()
    }

    if (element instanceof EnvironmentVariablesNode) {
      return element.getVariables()
    }

    return []
  }
}
