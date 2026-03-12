import * as vscode from "vscode"

import { createOrUpdateEnvSecret, createOrUpdateRepoSecret } from "~/commands/secrets/addSecret"
import { reportException } from "~/log"
import { SecretCommandArgs } from "~/treeViews/settings/secretNode"

export function registerUpdateSecret(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.settings.secret.update", async (args: SecretCommandArgs) => {
      const { gitHubRepoContext, secret, environment } = args

      const value = await vscode.window.showInputBox({
        prompt: "Enter the new secret value",
      })

      if (!value) {
        return
      }

      try {
        if (environment) {
          await createOrUpdateEnvSecret(gitHubRepoContext, environment.name, secret.name, value)
        } else {
          await createOrUpdateRepoSecret(gitHubRepoContext, secret.name, value)
        }
      } catch (e) {
        reportException(e, `Could not update secret ${secret.name}`)
      }
    }),
  )
}
