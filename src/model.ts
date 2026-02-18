import {Octokit} from "@octokit/rest";

type ActionResponse<T extends keyof Octokit["actions"]> = Awaited<ReturnType<Octokit["actions"][T]>>;
type ActionData<T extends keyof Octokit["actions"]> = ActionResponse<T>["data"];

type RepoResponse<T extends keyof Octokit["repos"]> = Awaited<ReturnType<Octokit["repos"][T]>>;
type RepoData<T extends keyof Octokit["repos"]> = RepoResponse<T>["data"];

//
// Domain contracts
//

export type Workflow = ActionData<"listRepoWorkflows">["workflows"][number];
export type WorkflowRun = ActionData<"getWorkflowRun">;
export type WorkflowRunAttempt = ActionData<"getWorkflowRunAttempt">;
export type WorkflowJob = ActionData<"getJobForWorkflowRun">;
export type WorkflowStep = NonNullable<WorkflowJob["steps"]>[number];
export type RepoSecret = ActionData<"listRepoSecrets">["secrets"][number];
export type RepoVariable = ActionData<"listRepoVariables">["variables"][number];
export type Environment = NonNullable<RepoData<"getAllEnvironments">["environments"]>[number];
export type EnvironmentSecret = ActionData<"listEnvironmentSecrets">["secrets"][number];
export type EnvironmentVariable = ActionData<"listEnvironmentVariables">["variables"][number];
export type OrgSecret = {name: string};
export type OrgVariable = {name: string; value: string};
