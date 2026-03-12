import * as vscode from "vscode"

import { useIntegratedBrowser } from "~/configuration/configReader"

export function openUri(uri: vscode.Uri) {
  const openResultPromise = useIntegratedBrowser()
    ? vscode.commands.executeCommand<boolean>("workbench.action.browser.open", uri.toString(true))
    : vscode.env.openExternal(uri)

  openResultPromise.then((openResult) => {
    if (openResult === false) {
      vscode.window.showErrorMessage(`Failed to open URL: ${uri.toString()}`)
    }
  })
}
