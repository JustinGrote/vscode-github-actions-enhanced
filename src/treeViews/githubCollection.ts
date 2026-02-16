import { QueryClient } from "@tanstack/query-core";
import { getGitHubContext,
GitHubContext } from "../git/repository";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/db";
import { getClient,
GhaOctokit } from "../api/api";
import { create } from "domain";
import { log,
logDebug } from "../log";

// This should be a singleton that is shared across the entire extension for shared cache reasons.
export const defaultQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Because we use conditional requests, this is OK to keep very low
			refetchInterval: 100
		}
	}
})

/** Create a collection that syncs to the backend GitHub API, and polls efficiently using conditional requests to minimize rate limit usage. Subscribe to the collection or a query on the collection to get updates when the data changes. */
export function createGithubCollection<TSelected extends object, TResult extends object, TParams extends object>(
	queryKey: string[],
	githubClient: GhaOctokit,
	apiCall: (params: TParams) => Promise<TResult>,
	apiParams: TParams,
	selector: (item: TResult) => TSelected[],
	compareFn: (a: TSelected, b: TSelected) => number,
	primaryKey: keyof TSelected,
	queryClient = defaultQueryClient,
) {
	return createCollection(queryCollectionOptions({
		queryClient: queryClient,
		startSync: true,
		syncMode: "eager",
		compare: compareFn,
		queryKey: queryKey,
		queryFn: async ({client}) => {
			logDebug(`♻️ Refreshing data for collection ${queryKey.join(",")}`);
			const response = await githubClient.conditionalRequest(apiCall, apiParams)
			// Indicates no changes to the API, so we should return the existing data to indicate no changes.
			if (!response) {
				logDebug(`👎 No changes detected for collection ${queryKey.join(",")}`);
				return client.getQueryData<TSelected[]>(queryKey) ?? [] as TSelected[];
			}

			// If the response is a single object, return it as an array
			logDebug(`✨ Changes detected for collection ${queryKey.join(",")}`);

			const result = selector(response);
			return result
		},
		getKey: (i) => String(i[primaryKey]),
	}))
}

export type GithubCollection<T extends object, TParams extends object> = ReturnType<typeof createGithubCollection<T, any, TParams>>;