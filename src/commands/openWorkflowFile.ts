import * as vscode from "vscode"

import { openUri } from "~/api/openUri"
import { getGitHubHtmlBaseUrl } from "~/configuration/configReader"
import { GitHubRepoContext } from "~/git/repository"
import { Workflow } from "~/model"
import { getWorkflowUri } from "~/workflow/workflow"

interface OpenWorkflowCommandArgs {
  gitHubRepoContext: GitHubRepoContext
  wf: Workflow
}

/**
 * Returns true if the workflow path represents a dynamic/built-in GitHub code scanning workflow
 * (e.g., `dynamic/github-code-scanning/codeql`), which does not correspond to a file in the workspace.
 */
function isDynamicCodeScanningWorkflow(path: string): boolean {
  return path.startsWith("dynamic/github-code-scanning/")
}

export function registerOpenWorkflowFile(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "github-actions.explorer.openWorkflowFile",
      async (args: OpenWorkflowCommandArgs) => {
        const { wf, gitHubRepoContext } = args

        // Handle dynamic/built-in GitHub code scanning workflows (e.g., CodeQL) that do not
        // exist as local files. Open the GitHub Code Scanning settings page instead.
        if (isDynamicCodeScanningWorkflow(wf.path)) {
          const baseUrl = getGitHubHtmlBaseUrl()
          const codeScanningUrl = `${baseUrl}/${gitHubRepoContext.owner}/${gitHubRepoContext.name}/security/code-scanning`
          openUri(vscode.Uri.parse(codeScanningUrl))
          return
        }

        const fileUri = getWorkflowUri(gitHubRepoContext, wf.path)
        if (fileUri) {
          try {
            const textDocument = await vscode.workspace.openTextDocument(fileUri)
            await vscode.window.showTextDocument(textDocument)
            return
          } catch {
            // Ignore error and show error message below
          }
        }

        // File not found in workspace
        await vscode.window.showErrorMessage(`Workflow ${wf.path} not found in current workspace`)
      },
    ),
  )
}
