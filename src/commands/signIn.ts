import * as vscode from "vscode"

import { canReachGitHubAPI } from "~/api/canReachGitHubAPI"
import { getSession } from "~/auth/auth"
import { getGitHubContext } from "~/git/repository"
import { setViewContext } from "~/viewState"

export function registerSignIn(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.sign-in", async () => {
      const session = await getSession(true)
      if (session) {
        const canReachAPI = await canReachGitHubAPI()
        const ghContext = await getGitHubContext()
        const hasGitHubRepos = ghContext && ghContext.repos.length > 0

        await setViewContext("signed-in")
        await setViewContext("internet-access", canReachAPI)
        await setViewContext("has-repos", hasGitHubRepos)
      }
    }),
  )
}
