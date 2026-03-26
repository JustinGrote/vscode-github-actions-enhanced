import * as vscode from "vscode"

import { getGitHubContext, resetGitHubContext } from "~/git/repository"
import { reportException } from "~/log"
import { setViewContext } from "~/viewState"

export function initWorkspaceChangeTracker(context: vscode.ExtensionContext) {
  const onDidChangeWorkspaceFolders = async (event: vscode.WorkspaceFoldersChangeEvent) => {
    try {
      if (event.added.length > 0 || event.removed.length > 0) {
        resetGitHubContext()
        const context = await getGitHubContext()
        const hasGitHubRepos = context && context.repos.length > 0
        await setViewContext("has-repos", hasGitHubRepos)
      }
    } catch (e) {
      reportException(e, "Error during workspace change")
    }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders))
}
