import { Event, EventEmitter, Disposable } from "vscode";
import { GitHubRepoContext } from "../git/repository";
import { WorkflowRun } from "../model";
import { setTimeout } from "node:timers/promises";
import { logTrace } from "../log";
import { CollectionConfigurationError,
createCollection,
createLiveQueryCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { QueryClient } from "@tanstack/query-core";


export abstract class WorkflowRunTreeDataProvider {


}
