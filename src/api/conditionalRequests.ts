import { logError } from "../log";
import { assertRequestError } from "../error";

export const conditionalRequest = () => ({
  conditionalRequest: returnIfChanged,
  // conditionalIterate: iterateIfChanged.bind(octokit)
});

// Map to store ETags for API requests. The key is the option
const etagMap = new Map<string, string>();
const timestampMap = new Map<string, string>();

/**
 * Makes an API request and returns the response data only if it has changed since the last request.
 * Uses ETags to determine if content has changed. If the server responds with 304 Not Modified,
 * the function returns undefined.
 * By default a hash of the json request is used to cache the etag. You can supply your own key separately
 *
 * @param request - The Octokit API request function to call
 * @param requestParams - The options to pass to the request function
 * @param cacheId - By default a stringify of the request options is used to cache the etag. You can supply your own key to identify the request, e.g. (getWorkFlowRuns-<workflowId>)
 * @param timestamp - If true, the cacheId will be assumed to be the last-modified time rather than an etag. This is useful if you did a list request and want to make rateless queries of individual nodes if they have changed.
 * @returns The response data if changed, or undefined if not modified (304)
 * @throws Will throw an error for any HTTP errors other than 304
 * @links https://docs.github.com/en/rest/overview/resources-in-the-rest-api#conditional-requests
 *
 * @remarks
 * It is the caller's responsibility to handle caching of the actual response data.
 * This function only tracks ETags internally to determine if content has changed,
 * but does not cache the actual response data between calls.
 */
async function returnIfChanged<TResponse, TParams>(request: (params: TParams) => Promise<TResponse>, requestParams?: TParams, cacheId?: string, timestamp: boolean = false): Promise<TResponse | undefined> {
	try {
    const options = {...requestParams} as TParams extends {headers: Record<string, string>}
      ? TParams
      : TParams & {headers: Record<string, string>};

    const cacheKey = cacheId ?? JSON.stringify(options);
    // Add If-None-Match header if we have an ETag for this key
    const cacheMatch = timestamp ? timestampMap.get(cacheKey) : etagMap.get(cacheKey);
    const cacheHeader = timestamp ? "if-modified-since" : "if-none-match";
    if (cacheMatch) {
      // Initialize headers if they don't exist
      if (!options.headers) {
        options.headers = {};
      }
      options.headers[cacheHeader] = cacheMatch;
    }

		// TODO: Figure out how to make this type safe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await request(options)) as any;

    // Store the new ETag if provided
    const responseEtag = timestamp ? response.headers.last_modified : response.headers.etag;
    if (responseEtag) {
      if (timestamp) {
        timestampMap.set(cacheKey, responseEtag);
      } else {
        etagMap.set(cacheKey, responseEtag);
      }
    }

    return response;
  } catch (e) {
		const err = assertRequestError(e);

		// Resource not modified (304), return undefined.
		if (err.status === 304) {
			return undefined;
		}

		logError(err);
		throw new Error("Error making conditional request: ", {cause: err});
	}
}

// /**
//  * Similar to `returnIfChanged`, but for paginated requests. Will return an async iterator that will return undefined if the specified page has not changed. It is up the to client to cache and react accordingly.
//  */
// async function iterateIfChanged<R extends keyof PaginatingEndpoints, P extends RestEndpointMethodTypes[R]["parameters"]>(
//   this: Octokit,
//   request: R,
//   params: P,
//   cacheId?: string
// ) {

// 	const cacheKey = cacheId ?? request.toString() + JSON.stringify(params);
// 	// Clone the params to avoid modifying the original
// 	const iteratorParams = { ...params };
// 	// Add If-None-Match header if we have an ETag for this key
// 	const etag = etagMap.get(cacheKey);
// 	if (etag) {
// 		// Initialize headers if they don't exist
// 		if (!iteratorParams.headers) {
// 			iteratorParams.headers = {};
// 		}
// 		iteratorParams.headers["if-none-match"] = etag;
// 	}



// 	// Create the iterator
// 	const iterator = composePaginateRest.iterator(this, request, iteratorParams);

// 	// Wrap the iterator in another async iterator to handle 304 responses
// 	return async function* etagInterceptedIterator() {
// 		// Adds an index to the ETag key to represent a page of requests
// 		let i = 0;
// 		try {
// 			for await (const { data, headers } of iterator) {
// 				// Store the ETag if present
// 				const responseEtag = headers.etag;
// 				if (responseEtag) {
// 					etagMap.set(cacheKey + i, responseEtag);
// 				}
// 				i++;

// 				// Add the current page of data to our results
// 				yield data;
// 			}
// 		} catch (err) {
// 			const httpError = err as {status: number};
// 			if (!httpError.status) {
// 				logError(err as Error, `Error making request`);
// 				throw err;
// 			}

// 			// Resource not modified (304), return undefined.
// 			if (httpError.status === 304) {
// 				return undefined;
// 			}

// 			// Re-throw any other error
// 			logError(err as Error, `Unexpected error making request`);
// 			throw err;
// 		}
// 	}
// }