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
import { getGitHubContext } from "~/git/repository"
import { init as initLogger, log, revealLog } from "~/log"
import { LogScheme } from "~/logs/constants"
import { WorkflowStepLogProvider } from "~/logs/fileProvider"
import { WorkflowStepLogFoldingProvider } from "~/logs/foldingProvider"
import { WorkflowStepLogSymbolProvider } from "~/logs/symbolProvider"
import { initPinnedWorkflows } from "~/pinnedWorkflows/pinnedWorkflows"
import { RunStore } from "~/store/store"
import { initWorkflowDocumentTracking } from "~/tracker/workflowDocumentTracker"
import { initWorkspaceChangeTracker } from "~/tracker/workspaceTracker"
import { initResources } from "~/treeViews/icons"
import { initTreeViews } from "~/treeViews/treeViews"
import { deactivateLanguageServer, initLanguageServer } from "~/workflow/languageServer"

export async function activate(context: vscode.ExtensionContext) {
  // Github Actions Enhanced conflict avoidance
  if (await officialExtensionIsActive()) return

  initLogger()
  if (!PRODUCTION) {
    // In debugging mode, always open the log for the extension in the `Output` window
    revealLog()
  }
  log("🚀 Activating GitHub Actions extension!")

  // Initialize extension components in parallel and report errors afterwards.
  const startupPromises: Promise<void>[] = []

  try {
    log("GitHub: Checking authentication and API access...")
    const hasSession = !!(await getSession())
    const canReachAPI = hasSession && (await canReachGitHubAPI())
    // Prefetch git repository origin url
    const ghContext = hasSession && (await getGitHubContext())
    const hasGitHubRepos = ghContext && ghContext.repos.length > 0

    registerSignIn(context)
    await Promise.all([
      vscode.commands.executeCommand("setContext", "github-actions.signed-in", hasSession),
      vscode.commands.executeCommand("setContext", "github-actions.internet-access", canReachAPI),
      vscode.commands.executeCommand("setContext", "github-actions.has-repos", hasGitHubRepos),
    ])

    initResources(context)
    initConfiguration(context)
    // Startup tree views
    startupPromises.push(initTreeViews(context))

    // Track workflow documents and workspace changes
    initWorkspaceChangeTracker(context)
    startupPromises.push(initWorkflowDocumentTracking(context))

    startupPromises.push(initLanguageServer(context))
    // //   TODO: Reimplement
    startupPromises.push(initPinnedWorkflows(new RunStore()))

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
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(LogScheme, new WorkflowStepLogProvider()),
    )
    context.subscriptions.push(
      vscode.languages.registerFoldingRangeProvider({ scheme: LogScheme }, new WorkflowStepLogFoldingProvider()),
    )
    context.subscriptions.push(
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

export function deactivate(): Thenable<void> | undefined {
  log("👋 Deactivating GitHub Actions extension")
  return deactivateLanguageServer()
}
