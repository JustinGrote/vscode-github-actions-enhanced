import * as vscode from "vscode"

import {WorkflowRunCommandArgs} from "../treeViews/shared/workflowRunNode"

export function registerCancelWorkflowRun(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.workflow.run.cancel", async (args: WorkflowRunCommandArgs) => {
      const gitHubRepoContext = args.gitHubRepoContext
      const run = args.run

      try {
        await gitHubRepoContext.client.actions.cancelWorkflowRun({
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          run_id: run.id,
        })
      } catch (e) {
        await vscode.window.showErrorMessage(`Could not cancel workflow: '${(e as Error).message}'`)
      }
    }),
  )
}
