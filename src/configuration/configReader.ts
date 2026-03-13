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

export function useIntegratedBrowser(): boolean {
  return getConfiguration().get<boolean>(getSettingsKey("useIntegratedBrowser"), true)
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

/**
 * Returns the GitHub HTML base URL (e.g., https://github.com) derived from the API URL.
 */
export function getGitHubHtmlBaseUrl(): string {
  const apiUri = getGitHubApiUri()
  if (apiUri === DEFAULT_GITHUB_API) {
    return "https://github.com"
  }
  try {
    const url = new URL(apiUri)
    // For GHE.com: https://api.myhost.ghe.com → https://myhost.ghe.com
    if (url.hostname.endsWith(".ghe.com")) {
      return `${url.protocol}//${url.hostname.replace(/^api\./, "")}`
    }
  } catch {
    // Fall through to GHES handling
  }
  // For GHES: https://myghes/api/v3 → https://myghes
  return apiUri.replace(/\/api\/v3$/, "")
}
