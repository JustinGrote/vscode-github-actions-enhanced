import * as vscode from "vscode"

import { openUri } from "~/api/openUri"
import { WorkflowRunCommandArgs } from "~/treeViews/shared/workflowRunNode"

export function registerOpenWorkflowRun(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.workflow.run.open", async (args: WorkflowRunCommandArgs) => {
      const run = args.run
      const url = run.html_url
      openUri(vscode.Uri.parse(url))
    }),
  )
}
