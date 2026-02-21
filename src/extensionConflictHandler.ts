import * as vscode from "vscode"
export async function assertOfficalExtensionNotPresent() {
  // Check if the GitHub Actions extension is installed and active
  const extension = vscode.extensions.getExtension("GitHub.vscode-github-actions")
  if (extension) {
    await extension.activate()
    if (extension.isActive) {
      vscode.window.showErrorMessage(
        `You must disable the GitHub Actions extension first to use Github Actions Enhanced!`,
        {
          modal: true,
          detail: `The GitHub Actions Enhanced extension cannot run at the same time as the official Github Actions extension. Please go to the extensions menu and uninstall or disable the official extension and then reload your vscode window (extension host restart is not sufficient!).`,
        },
      )
      return true
    }
  }
  return false
}
