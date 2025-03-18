import * as vscode from "vscode";
import {onRateLimitUpdated, rateLimit} from "./api/rateLimitTelemetry";

// The status bar item should be a singleton
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Creates and manages a status bar item that shows GitHub API rate limit information.
 * When clicked, it shows detailed rate limit information in a notification.
 */
export function registerRateLimitStatusBar(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem("githubActions", vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(github-action)";
    statusBarItem.command = "github-actions.showRateLimitInfo";
    // Register the command to show rate limit information
    vscode.commands.registerCommand("github-actions.showRateLimitInfo", showRateLimitInfo);
  }

  onRateLimitUpdated(rateLimit => {
    if (statusBarItem && rateLimit.used !== null && rateLimit.limit !== null) {
      statusBarItem.text = `$(github-action) ${rateLimit.remaining}`;
      statusBarItem.tooltip = `API Use: ${rateLimit.used}/${rateLimit.limit}`;
    }
  });

  statusBarItem.show();
  return statusBarItem;
}

/**
 * Shows a notification with detailed rate limit information
 */
function showRateLimitInfo(): void {
  if (rateLimit.used !== null && rateLimit.limit !== null) {
    const resetTime = rateLimit.reset ? `Reset: ${rateLimit.reset.toLocaleTimeString()}` : "Reset time unknown";

    const percentage = Math.round((rateLimit.used / rateLimit.limit) * 100);

    vscode.window.showInformationMessage(
      `API Use: ${rateLimit.used}/${rateLimit.limit} (${percentage}%)\n` + resetTime
    );
  } else {
    vscode.window.showInformationMessage("No GitHub API rate limit data available yet.");
  }
}
