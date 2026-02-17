import * as vscode from "vscode";

import {
  getPinnedWorkflows,
  isPinnedWorkflowsRefreshEnabled,
  onPinnedWorkflowsChange,
  pinnedWorkflowsRefreshInterval
} from "../configuration/configuration";
import {getGitHubContextForWorkspaceUri, GitHubRepoContext} from "../git/repository";

import {sep} from "path";
import {log, logDebug, logError} from "../log";
import {Workflow} from "../model";
import {RunStore} from "../store/store";
import {WorkflowRun} from "../store/workflowRun";
import {getCodIconForWorkflowRun} from "../treeViews/icons";
import {WorkflowRunCommandArgs} from "../treeViews/shared/workflowRunNode";
import {ensureError} from "../error";
import {RequestError} from "@octokit/request-error";

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
  logDebug("Initializing pinned workflows watcher");
  await updatePinnedWorkflows();

  if (refreshTimer) {
    logDebug("Existing pinned workflows refresh timer found, clearing it");
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  if (isPinnedWorkflowsRefreshEnabled()) {
    logDebug("Pinned workflows refresh enabled, checking every", pinnedWorkflowsRefreshInterval(), "seconds");
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
    const workflows: Workflow[] = await gitHubRepoContext.client.paginate(gitHubRepoContext.client.actions.listRepoWorkflows, {
      owner: gitHubRepoContext.owner,
      repo: gitHubRepoContext.name,
      per_page: 100
    });

    const workflowByPath: Record<string, Workflow> = {};
    workflows.forEach(w => (workflowByPath[w.path] = w));

    await Promise.all(
      (workflowsByWorkspace.get(workspaceName) || []).map(async pinnedWorkflow => {
        if (!workflowByPath[pinnedWorkflow]) {
          log(`Unable to find pinned workflow ${pinnedWorkflow} in ${workspaceName}, ignoring`);
          return;
        }

        const pW = createPinnedWorkflow(gitHubRepoContext, workflowByPath[pinnedWorkflow]);
        return refreshPinnedWorkflow(pW);
      })
    );
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
    workflowId: (workflow as any).id,
    workflowName: (workflow as any).name,
    lastRunId: undefined,
    statusBarItem
  };

  pinnedWorkflows.push(pinnedWorkflow);

  return pinnedWorkflow;
}

async function refreshPinnedWorkflows() {
  for (const pinnedWorkflow of pinnedWorkflows) {
    await refreshPinnedWorkflow(pinnedWorkflow);
  }
}

async function refreshPinnedWorkflow(pinnedWorkflow: PinnedWorkflow) {
  const {gitHubRepoContext} = pinnedWorkflow;
  const {client} = gitHubRepoContext;
  logDebug("Checking for updates to pinned workflow", pinnedWorkflow.workflowName, "in", gitHubRepoContext.name);
  try {
    const workflowRunCacheId = `MostRecentRun-${gitHubRepoContext.owner}/${gitHubRepoContext.name}/${pinnedWorkflow.workflowId}`;
    const workflowRunResult = await client.conditionalRequest(
      client.actions.listWorkflowRuns,
      {
        owner: gitHubRepoContext.owner,
        repo: gitHubRepoContext.name,
        workflow_id: pinnedWorkflow.workflowId,
        per_page: 1,
        page: 1
      },
      workflowRunCacheId
    );

    if (workflowRunResult === undefined) {
      logDebug("No new runs detected for pinned workflow", pinnedWorkflow.workflowName);
      return;
    }

    const mostRecentRun = workflowRunResult.data.workflow_runs[0];
    logDebug("Updating pinned workflow", pinnedWorkflow.workflowName, "with most recent run id", mostRecentRun?.id);

    runStore.addRun(gitHubRepoContext, mostRecentRun);

    updatePinnedWorkflow(pinnedWorkflow, mostRecentRun && runStore.getRun(mostRecentRun.id));
  } catch (e) {
    const error = ensureError(e);

    // Filter out non-RequestError. This will enable type inference.
    if (!(error instanceof RequestError)) {
      logError(error, "Unknown Error checking for pinned workflow updates");
      return;
    }

    logError(error, "Error checking for pinned workflow updates");
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
          run: run.run,
          gitHubRepoContext: pinnedWorkflow.gitHubRepoContext
        } satisfies WorkflowRunCommandArgs
      ]
    };
  }

  pinnedWorkflow.lastRunId = run?.run.id;

  // Ensure the status bar item is visible
  pinnedWorkflow.statusBarItem.show();
}
