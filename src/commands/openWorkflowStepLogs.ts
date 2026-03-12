import * as vscode from "vscode"

import { openUri } from "~/api/openUri"
import { WorkflowStep } from "~/model"
import { WorkflowStepNode } from "~/treeViews/shared/workflowStepNode"

type WorkflowStepCommandArgs = Pick<WorkflowStepNode, "job" | "step" | "gitHubRepoContext">

export function registerOpenWorkflowStepLogs(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("github-actions.step.logs", async (args: WorkflowStepCommandArgs) => {
      const job = args.job
      let url = job.html_url ?? ""
      const stepName = args.step.name

      const index = job.steps && job.steps.findIndex((step: WorkflowStep) => step.name === stepName) + 1

      if (url && index) {
        url = url + "#step:" + index.toString() + ":1"
      }

      openUri(vscode.Uri.parse(url))
    }),
  )
}
