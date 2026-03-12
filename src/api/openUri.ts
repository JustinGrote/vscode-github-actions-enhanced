import * as vscode from "vscode"

import { useIntegratedBrowser } from "~/configuration/configReader"
import { reportException } from "~/log"

export function openUri(uri: vscode.Uri) {
  const openResultPromise = useIntegratedBrowser()
    ? vscode.commands.executeCommand<boolean>("workbench.action.browser.open", uri.toString(true))
    : vscode.env.openExternal(uri)

  openResultPromise
    .then((openResult) => {
      if (openResult === false) {
        reportException(`Failed to open URL: ${uri.toString()}`)
      }
    })
}
