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

export function registerOpenWorkflowFile(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "github-actions.explorer.openWorkflowFile",
      async (args: OpenWorkflowCommandArgs) => {
        const { wf, gitHubRepoContext } = args

        // Dynamic/built-in GitHub workflows have no local file counterpart.
        if (wf.path.startsWith("dynamic/")) {
          // Code scanning workflows open the GitHub Code Scanning settings page.
          if (wf.path.startsWith("dynamic/github-code-scanning/")) {
            const baseUrl = getGitHubHtmlBaseUrl()
            const codeScanningUrl = `${baseUrl}/${gitHubRepoContext.owner}/${gitHubRepoContext.name}/security/code-scanning`
            openUri(vscode.Uri.parse(codeScanningUrl))
          }
          // All other dynamic/* paths (e.g. copilot-pull-request-reviewer, copilot-swe-agent)
          // have no actionable local file; the UI button is hidden for them, so nothing to do.
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
