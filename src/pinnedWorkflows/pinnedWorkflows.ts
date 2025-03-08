import * as vscode from "vscode";

import {
  getPinnedWorkflows,
  isPinnedWorkflowsRefreshEnabled,
  onPinnedWorkflowsChange,
  pinnedWorkflowsRefreshInterval
} from "../configuration/configuration";
import {getGitHubContextForWorkspaceUri, GitHubRepoContext} from "../git/repository";

import {sep} from "path";
import {log, logError} from "../log";
import {Workflow} from "../model";
import {RunStore} from "../store/store";
import {WorkflowRun} from "../store/workflowRun";
import {getCodIconForWorkflowRun} from "../treeViews/icons";
import {WorkflowRunCommandArgs} from "../treeViews/shared/workflowRunNode";

interface PinnedWorkflow {
  /** Displayed name */
  workflowName: string;

  workflowId: number;

  lastRunId: number | undefined;

  gitHubRepoContext: GitHubRepoContext;

  /** Status bar item created for this workflow */
  statusBarItem: vscode.StatusBarItem;
}

const pinnedWorkflows: PinnedWorkflow[] = [];
let refreshTimer: NodeJS.Timeout | undefined;
let runStore: RunStore;

// Add a map to store ETags for workflow requests
const workflowEtagMap = new Map<number, string>();

export async function initPinnedWorkflows(store: RunStore) {
  // Register handler for configuration changes
  onPinnedWorkflowsChange(() => void _init());

  runStore = store;
  runStore.event(({run}) => {
    // Are we listening to this run?
    const workflowId = run.run.workflow_id;
    for (const pinnedWorkflow of pinnedWorkflows) {
      if (pinnedWorkflow.workflowId === workflowId && pinnedWorkflow.lastRunId === run.run.id) {
        updatePinnedWorkflow(pinnedWorkflow, run);
        break;
      }
    }
  });

  await _init();
}

async function _init(): Promise<void> {
  await updatePinnedWorkflows();

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  if (isPinnedWorkflowsRefreshEnabled()) {
    refreshTimer = setInterval(() => void refreshPinnedWorkflows(), pinnedWorkflowsRefreshInterval() * 1000);
  }
}

async function updatePinnedWorkflows() {
  clearPinnedWorkflows();
  const pinnedWorkflows = getPinnedWorkflows();

  // Assume we have a folder open. Without a folder open, we can't do anything
  if (!vscode.workspace.workspaceFolders?.length) {
    return;
  }

  const firstWorkspaceFolderName = vscode.workspace.workspaceFolders[0].name;

  const workflowsByWorkspace = new Map<string, string[]>();

  for (const pinnedWorkflow of pinnedWorkflows) {
    const workflowPath = pinnedWorkflow;
    if (pinnedWorkflow.startsWith(".github/")) {
      // No workspace, attribute to the first workspace folder
      workflowsByWorkspace.set(firstWorkspaceFolderName, [
        pinnedWorkflow,
        ...(workflowsByWorkspace.get(firstWorkspaceFolderName) || [])
      ]);
    } else {
      const [workSpaceName, ...r] = workflowPath.split(sep);
      workflowsByWorkspace.set(workSpaceName, [r.join(sep), ...(workflowsByWorkspace.get(workSpaceName) || [])]);
    }
  }

  for (const workspaceName of workflowsByWorkspace.keys()) {
    const workspace = vscode.workspace.workspaceFolders?.find(x => x.name === workspaceName);
    if (!workspace) {
      continue;
    }

    const gitHubRepoContext = await getGitHubContextForWorkspaceUri(workspace.uri);
    if (!gitHubRepoContext) {
      return;
    }

    // Get all workflows to resolve names. We could do this locally, but for now, let's make the API call.
    const workflows = await gitHubRepoContext.client.paginate(
      // @ts-expect-error FIXME: Newer Typescript catches a problem that previous didn't. This will be fixed in Octokit bump.
      gitHubRepoContext.client.actions.listRepoWorkflows,
      {
        owner: gitHubRepoContext.owner,
        repo: gitHubRepoContext.name,
        per_page: 100
      },
      response => response.data
    );

    const workflowByPath: {[id: string]: Workflow} = {};
    // @ts-expect-error FIXME: Newer Typescript catches a problem that previous didn't. This will be fixed in Octokit bump.
    workflows.forEach(w => (workflowByPath[w.path] = w));

    for (const pinnedWorkflow of workflowsByWorkspace.get(workspaceName) || []) {
      if (!workflowByPath[pinnedWorkflow]) {
        log(`Unable to find pinned workflow ${pinnedWorkflow} in ${workspaceName}, ignoring`);
        continue;
      }

      const pW = createPinnedWorkflow(gitHubRepoContext, workflowByPath[pinnedWorkflow]);
      await refreshPinnedWorkflow(pW);
    }
  }
}

async function refreshPinnedWorkflows() {
  for (const pinnedWorkflow of pinnedWorkflows) {
    await refreshPinnedWorkflow(pinnedWorkflow);
  }
}

function clearPinnedWorkflows() {
  // Remove any existing pinned workflows
  for (const pinnedWorkflow of pinnedWorkflows) {
    pinnedWorkflow.statusBarItem.hide();
    pinnedWorkflow.statusBarItem.dispose();
  }

  pinnedWorkflows.splice(0, pinnedWorkflows.length);
}

function createPinnedWorkflow(gitHubRepoContext: GitHubRepoContext, workflow: Workflow): PinnedWorkflow {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  const pinnedWorkflow = {
    gitHubRepoContext,
    workflowId: workflow.id,
    workflowName: workflow.name,
    lastRunId: undefined,
    statusBarItem
  };

  pinnedWorkflows.push(pinnedWorkflow);

  return pinnedWorkflow;
}

async function refreshPinnedWorkflow(pinnedWorkflow: PinnedWorkflow) {
  const {gitHubRepoContext} = pinnedWorkflow;

  try {
    const requestOptions = {
      owner: gitHubRepoContext.owner,
      repo: gitHubRepoContext.name,
      workflow_id: pinnedWorkflow.workflowId,
      per_page: 1,
      headers: {}
    };

    // Conditional Headers: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28#use-conditional-requests-if-appropriate

    // Add If-None-Match header if we have an ETag for this workflow
    const etag = workflowEtagMap.get(pinnedWorkflow.workflowId);
    if (etag) {
      requestOptions.headers = {
        "if-none-match": etag
      };
    }

    const runs = await gitHubRepoContext.client.actions.listWorkflowRuns(requestOptions);

    // Store the new ETag if provided
    const responseEtag = runs.headers.etag;
    if (responseEtag) {
      workflowEtagMap.set(pinnedWorkflow.workflowId, responseEtag);
    }

    // If we get data, process it (a 304 response won't have data)
    if (runs.data && runs.data.workflow_runs) {
      const {workflow_runs} = runs.data;

      // Add all runs to store
      for (const run of workflow_runs) {
        runStore.addRun(gitHubRepoContext, run);
      }

      const mostRecentRun = workflow_runs?.[0];
      updatePinnedWorkflow(pinnedWorkflow, mostRecentRun && runStore.getRun(mostRecentRun.id));
    }
    // If it was a 304, the data hasn't changed so we don't need to update anything
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpError = err as any;

    if (!httpError.status) {
      logError(err as Error, "Unknown Error checking for pinned workflow updates");
      return;
    }

    // Resource not modified, which is normal. Our rate-limit should not decrease with this response
    if (httpError.status === 304) {
      return;
    }

    logError(err as Error, "Error checking for pinned workflow updates");
  }
}

function updatePinnedWorkflow(pinnedWorkflow: PinnedWorkflow, run: WorkflowRun | undefined) {
  if (!run) {
    // Workflow has never run, set default text
    pinnedWorkflow.statusBarItem.text = `$(${getCodIconForWorkflowRun()}) ${pinnedWorkflow.workflowName}`;

    // Can't do anything without a run
    pinnedWorkflow.statusBarItem.command = undefined;
  } else {
    pinnedWorkflow.statusBarItem.text = `$(${getCodIconForWorkflowRun(run.run)}) ${pinnedWorkflow.workflowName}`;

    if (run.run.conclusion === "failure") {
      pinnedWorkflow.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else {
      pinnedWorkflow.statusBarItem.backgroundColor = undefined;
    }

    pinnedWorkflow.statusBarItem.command = {
      title: "Open workflow run",
      command: "github-actions.workflow.run.open",
      arguments: [
        {
          run: run,
          store: runStore,
          gitHubRepoContext: pinnedWorkflow.gitHubRepoContext
        } satisfies WorkflowRunCommandArgs
      ]
    };
  }

  pinnedWorkflow.lastRunId = run?.run.id;

  // Ensure the status bar item is visible
  pinnedWorkflow.statusBarItem.show();
}