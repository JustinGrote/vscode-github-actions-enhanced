import * as vscode from "vscode"

export const ViewContextStates = {
  Started: "started",
  SignedIn: "signed-in",
  NeedsSignIn: "needs-sign-in",
  GitAvailable: "git-available",
  NeedsGit: "needs-git",
  HasRepos: "has-repos",
  NoRepos: "no-repos",
  InternetAccess: "internet-access",
} as const

export type ViewContextState = (typeof ViewContextStates)[keyof typeof ViewContextStates]

const viewContextNamespace = "github-actions."

/** Use this function to set the view context for the extension in a type safe manner that is cleaned up on extension deactivation */
export async function setViewContext(key: ViewContextState, value: boolean = true) {
  await vscode.commands.executeCommand("setContext", viewContextNamespace + key, value)
}

export async function resetViewContext() {
  for (const key in ViewContextStates) {
    setViewContext(ViewContextStates[key as keyof typeof ViewContextStates], false)
  }
}

export const resetViewContextOnDispose: vscode.Disposable = {
  dispose: resetViewContext,
}
