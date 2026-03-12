import type { RequestError } from "@octokit/request-error"
import * as vscode from "vscode"

import { getGitHubContextForRepo } from "~/git/repository"
import { reportException } from "~/log"
import { cacheLogInfo } from "~/logs/logInfo"
import { parseLog } from "~/logs/model"
import { parseUri } from "~/logs/scheme"

export class WorkflowStepLogProvider implements vscode.TextDocumentContentProvider {
  onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>()
  onDidChange = this.onDidChangeEmitter.event

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { owner, repo, jobId } = parseUri(uri)

    const githubRepoContext = await getGitHubContextForRepo(owner, repo)
    if (!githubRepoContext) {
      throw new Error("Could not load logs")
    }

    try {
      // We only need a simple octokit client for this task
      const result = await githubRepoContext?.client.actions.downloadJobLogsForWorkflowRun({
        owner: owner,
        repo: repo,
        job_id: jobId,
      })

      const log = result.data

      const logInfo = parseLog(log as string)
      cacheLogInfo(uri, logInfo)

      return logInfo.updatedLogLines.join("\n")
    } catch (e) {
      const respErr = e as RequestError
      if (respErr.status === 403) {
        // HACK: Perform a raw fetch for the logs. Need to fix this in the redirect plugin handler
        const response = await fetch(respErr.response?.url || "")
        const logInfo = parseLog(await response.text())
        cacheLogInfo(uri, logInfo)
        return logInfo.updatedLogLines.join("\n")
      }
      if (respErr.status === 410) {
        cacheLogInfo(uri, {
          sections: [],
          updatedLogLines: [],
          styleFormats: [],
        })

        return "Could not open logs, they are expired."
      }

      reportException(e, `Could not open logs for job ${jobId}`)
    }
  }
}
