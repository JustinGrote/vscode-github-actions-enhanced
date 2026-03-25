import * as vscode from "vscode"

import { PendingApprovalCommandArgs } from "~/treeViews/shared/pendingApprovalNode"

export function registerApproveWorkflowRun(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.workflow.run.approve", async (args: PendingApprovalCommandArgs) => {
      const { gitHubRepoContext, run } = args

      try {
        await gitHubRepoContext.client.actions.approveWorkflowRun({
          owner: gitHubRepoContext.owner,
          repo: gitHubRepoContext.name,
          run_id: run.id,
        })
      } catch (e) {
        await vscode.window.showErrorMessage(
          `Could not approve workflow run #${run.run_number}: '${(e as Error).message}'`,
        )
      }
    }),
  )
}
