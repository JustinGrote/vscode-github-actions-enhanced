import {Octokit} from "@octokit/core"
import {EventEmitter} from "vscode"

// Exported variables to track rate limits
export interface RateLimit {
  remaining: number | null
  limit: number | null
  reset: Date | null
  used: number | null
}

export const rateLimit: RateLimit = {
  remaining: null,
  limit: null,
  reset: null,
  used: null,
}

const rateLimitUpdatedEvent = new EventEmitter<RateLimit>()
export const onRateLimitUpdated = rateLimitUpdatedEvent.event

/**
 * Octokit plugin to track GitHub API rate limits
 */
export const rateLimitTelemetryPlugin = (octokit: Octokit) => {
  octokit.hook.wrap("request", async (request, options) => {
    const response = await request(options)

    // Extract rate limit information from headers
    if (response.headers) {
      const remaining = response.headers["x-ratelimit-remaining"]
      const limit = response.headers["x-ratelimit-limit"]
      const reset = response.headers["x-ratelimit-reset"]
      const used = response.headers["x-ratelimit-used"]

      // Update exported variables if headers are present
      if (remaining) rateLimit.remaining = parseInt(String(remaining))
      if (limit) rateLimit.limit = parseInt(String(limit))
      if (reset) rateLimit.reset = new Date(parseInt(String(reset)) * 1000)
      if (used) rateLimit.used = parseInt(String(used))
    }
    rateLimitUpdatedEvent.fire(rateLimit)

    return response
  })

  return {
    ratelimit: rateLimit,
  }
}
