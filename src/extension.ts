import * as vscode from "vscode"

import { canReachGitHubAPI } from "~/api/canReachGitHubAPI"
import { getSession } from "~/auth/auth"
import { registerCancelWorkflowRun } from "~/commands/cancelWorkflowRun"
import { registerOpenWorkflowFile } from "~/commands/openWorkflowFile"
import { registerOpenWorkflowJobLogs } from "~/commands/openWorkflowJobLogs"
import { registerOpenWorkflowRun } from "~/commands/openWorkflowRun"
import { registerOpenWorkflowStepLogs } from "~/commands/openWorkflowStepLogs"
import { registerPinWorkflow } from "~/commands/pinWorkflow"
import { registerReRunWorkflowRun } from "~/commands/rerunWorkflowRun"
import { registerAddSecret } from "~/commands/secrets/addSecret"
import { registerCopySecret } from "~/commands/secrets/copySecret"
import { registerDeleteSecret } from "~/commands/secrets/deleteSecret"
import { registerUpdateSecret } from "~/commands/secrets/updateSecret"
import { registerSignIn } from "~/commands/signIn"
import { registerTriggerWorkflowRun } from "~/commands/triggerWorkflowRun"
import { registerUnPinWorkflow } from "~/commands/unpinWorkflow"
import { registerAddVariable } from "~/commands/variables/addVariable"
import { registerCopyVariable } from "~/commands/variables/copyVariable"
import { registerDeleteVariable } from "~/commands/variables/deleteVariable"
import { registerUpdateVariable } from "~/commands/variables/updateVariable"
import { initConfiguration } from "~/configuration/configuration"
import { assertOfficalExtensionNotPresent as officialExtensionIsActive } from "~/extensionConflictHandler"
import { getGitExtension, getGitHubContext } from "~/git/repository"
import { init as initLogger, log, logTrace, logWarn, revealLog } from "~/log"
import { LogScheme } from "~/logs/constants"
import { WorkflowStepLogProvider } from "~/logs/fileProvider"
import { WorkflowStepLogFoldingProvider } from "~/logs/foldingProvider"
import { WorkflowStepLogSymbolProvider } from "~/logs/symbolProvider"
import { initWorkflowDocumentTracking } from "~/tracker/workflowDocumentTracker"
import { initWorkspaceChangeTracker } from "~/tracker/workspaceTracker"
import { initResources } from "~/treeViews/icons"
import { initTreeViews } from "~/treeViews/treeViews"
import { setViewContext } from "~/viewState"
import { deactivateLanguageServer, initLanguageServer } from "~/workflow/languageServer"

/** Use this as a global convenience for registering disposables */
let saveExtensionDisposables: (disposable: vscode.Disposable[]) => void
const extensionDisposables = new Promise<vscode.Disposable[]>((resolve) => {
  saveExtensionDisposables = resolve
})

export async function registerDisposable(...disposables: vscode.Disposable[]) {
  const extensionDisposablesList = await extensionDisposables
  extensionDisposablesList.push(...disposables)
}

export async function unregisterDisposable(disposable: vscode.Disposable) {
  const disposables = await extensionDisposables
  const index = disposables.indexOf(disposable)
  if (index !== -1) {
    disposables.splice(index, 1)
  }
}

export async function activate(context: vscode.ExtensionContext) {
  if (await officialExtensionIsActive()) return

  initLogger()
  if (!PRODUCTION) {
    // In debugging mode, always open the log for the extension in the `Output` window
    revealLog()
  }
  log("🚀 Activating GitHub Actions extension!")

  await setViewContext("started")

  saveExtensionDisposables(context.subscriptions)

  // Initialize extension components in parallel and report errors afterwards.
  const startupPromises: Promise<void>[] = []

  try {
    registerSignIn(context)

    log("GitHub: Checking authentication and API access...")
    const hasSession = !!(await getSession())
    void (hasSession ? await setViewContext("signed-in") : await setViewContext("needs-sign-in"))

    log("Waiting for git extension...")
    const gitExtension = await getGitExtension()
    void (gitExtension ? await setViewContext("git-available", true) : await setViewContext("needs-git", false))

    const canReachAPI = hasSession && (await canReachGitHubAPI())
    setViewContext("internet-access", canReachAPI)
    // Prefetch git repository origin url
    const ghContext = hasSession && (await getGitHubContext())
    const hasGitHubRepos = !!ghContext && ghContext.repos.length > 0
    void (hasGitHubRepos ? await setViewContext("has-repos") : await setViewContext("no-repos"))

    initResources(context)
    initConfiguration(context)
    // Startup tree views
    startupPromises.push(initTreeViews(context))

    // Track workflow documents and workspace changes
    initWorkspaceChangeTracker(context)
    startupPromises.push(initWorkflowDocumentTracking(context))

    startupPromises.push(initLanguageServer(context))
    // //   TODO: Reimplement
    // startupPromises.push(initPinnedWorkflows(new RunStore()))

    // Commands
    registerOpenWorkflowRun(context)
    registerOpenWorkflowFile(context)
    registerOpenWorkflowJobLogs(context)
    registerOpenWorkflowStepLogs(context)
    registerTriggerWorkflowRun(context)
    registerReRunWorkflowRun(context)
    registerCancelWorkflowRun(context)
    registerAddVariable(context)
    registerUpdateVariable(context)
    registerDeleteVariable(context)
    registerCopyVariable(context)
    registerPinWorkflow(context)
    registerUnPinWorkflow(context)

    // Secret management
    registerAddSecret(context)
    registerDeleteSecret(context)
    registerCopySecret(context)
    registerUpdateSecret(context)

    // Log providers
    registerDisposable(
      vscode.workspace.registerTextDocumentContentProvider(LogScheme, new WorkflowStepLogProvider()),
      vscode.languages.registerFoldingRangeProvider({ scheme: LogScheme }, new WorkflowStepLogFoldingProvider()),
      vscode.languages.registerDocumentSymbolProvider(
        {
          scheme: LogScheme,
        },
        new WorkflowStepLogSymbolProvider(),
      ),
    )

    await Promise.all(startupPromises)

    log("⭐ Github Actions extension activated!")
  } catch (error) {
    // Surface unhandled exceptions more explicitly.
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    vscode.window.showErrorMessage("Failed to activate GitHub Actions extension: " + message)

    throw error
  }
}

export async function deactivate(): Promise<void> {
  return deactivateLanguageServer()
}
