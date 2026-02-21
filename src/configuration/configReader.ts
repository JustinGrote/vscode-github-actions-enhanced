import * as vscode from "vscode"

/**
 * Pure configuration reader functions with no other imports.
 * This module exists to break circular dependencies between configuration, api, auth, git, and workflow modules.
 */

const settingsKey = "github-actions"
const DEFAULT_GITHUB_API = "https://api.github.com"

function getConfiguration() {
  return vscode.workspace.getConfiguration()
}

function getSettingsKey(settingsPath: string): string {
  return `${settingsKey}.${settingsPath}`
}

export function getRemoteName(): string {
  return getConfiguration().get<string>(getSettingsKey("remote-name"), "origin")
}

export function useEnterprise(): boolean {
  return getConfiguration().get<boolean>(getSettingsKey("use-enterprise"), false)
}

export function getGitHubApiUri(): string {
  if (!useEnterprise()) return DEFAULT_GITHUB_API
  const base = getConfiguration().get<string>("github-enterprise.uri", DEFAULT_GITHUB_API).replace(/\/$/, "")
  if (base === DEFAULT_GITHUB_API) {
    return base
  }

  if (base.endsWith(".ghe.com")) {
    return base.replace(/^(https?):\/\//, "$1://api.")
  } else {
    return `${base}/api/v3`
  }
}
