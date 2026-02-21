import * as vscode from "vscode"

import { useEnterprise } from "~/configuration/configReader"
import { resetGitHubContext } from "~/git/repository"
import { deactivateLanguageServer, initLanguageServer } from "~/workflow/languageServer"

const settingsKey = "github-actions"
const PINNED_WORKFLOWS_KEY = `${settingsKey}.pinnedWorkflows`

// Store workspaceState directly for easier access
let workspaceState: vscode.Memento | undefined

export function initConfiguration(context: vscode.ExtensionContext) {
  // Store the workspaceState for later use
  workspaceState = context.workspaceState

  // Migrate existing pinned workflows from settings to workspaceState
  migrateSettingsToPinnedWorkflows()

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      // Since we're no longer using settings for pinned workflows, we don't need to check for them
      if (
        e.affectsConfiguration(getSettingsKey("use-enterprise")) ||
        (useEnterprise() &&
          (e.affectsConfiguration("github-enterprise.uri") || e.affectsConfiguration(getSettingsKey("remote-name"))))
      ) {
        await updateLanguageServerApiUrl(context)
        resetGitHubContext()
        await vscode.commands.executeCommand("github-actions.explorer.refresh")
      }
    }),
  )
}

// Migrate existing pinned workflows from settings to workspaceState
async function migrateSettingsToPinnedWorkflows() {
  if (!workspaceState) return

  // Get workflows from settings
  const existingSettingsPinnedWorkflows = getConfiguration().get<string[]>(
    getSettingsKey("workflows.pinned.workflows"),
    [],
  )

  // If there are workflows in settings and none in workspaceState, migrate them
  if (existingSettingsPinnedWorkflows.length > 0 && getPinnedWorkflows().length === 0) {
    workspaceState.update(PINNED_WORKFLOWS_KEY, existingSettingsPinnedWorkflows)
    // Display a message about the migration
    vscode.window.showInformationMessage(
      "The setting `github-actions.workflows.pinned.workflows` is now deprecated. Please remove references in your user and workspace settings. We have automatically migrated existing pinned workflows to the workspace state and they will now be persisted across sessions.",
    )
  }
}

function getConfiguration() {
  return vscode.workspace.getConfiguration()
}

function getSettingsKey(settingsPath: string): string {
  return `${settingsKey}.${settingsPath}`
}

const pinnedWorkflowsChangeHandlers: (() => void)[] = []
export function onPinnedWorkflowsChange(handler: () => void) {
  pinnedWorkflowsChangeHandlers.push(handler)
}

export function getPinnedWorkflows(): string[] {
  if (!workspaceState) return []
  return workspaceState.get<string[]>(PINNED_WORKFLOWS_KEY, [])
}

export async function pinWorkflow(workflow: string) {
  if (!workspaceState) return

  const pinnedWorkflows = Array.from(new Set(getPinnedWorkflows()).add(workflow))
  await workspaceState.update(PINNED_WORKFLOWS_KEY, pinnedWorkflows)

  // Notify handlers of the change
  pinnedWorkflowsChangeHandlers.forEach((h) => h())
}

export async function unpinWorkflow(workflow: string) {
  if (!workspaceState) return

  const x = new Set(getPinnedWorkflows())
  x.delete(workflow)
  const pinnedWorkflows = Array.from(x)
  await workspaceState.update(PINNED_WORKFLOWS_KEY, pinnedWorkflows)

  // Notify handlers of the change
  pinnedWorkflowsChangeHandlers.forEach((h) => h())
}

export function isPinnedWorkflowsRefreshEnabled(): boolean {
  return getConfiguration().get<boolean>(getSettingsKey("workflows.pinned.refresh.enabled"), false)
}

export function pinnedWorkflowsRefreshInterval(): number {
  return getConfiguration().get<number>(getSettingsKey("workflows.pinned.refresh.interval"), 1)
}

export function getRunsPrefetchCount(): number {
  return getConfiguration().get<number>(getSettingsKey("runs.prefetch.count"), 3)
}

// Re-export from configReader to maintain backward compatibility
// These functions are in a separate module to break circular dependencies
export { getRemoteName, useEnterprise, getGitHubApiUri } from "./configReader"

async function updateLanguageServerApiUrl(context: vscode.ExtensionContext) {
  await deactivateLanguageServer()

  await initLanguageServer(context)
}
