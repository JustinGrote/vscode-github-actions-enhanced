/* eslint-disable @typescript-eslint/no-explicit-any */
import {Octokit} from "@octokit/rest";
import {version} from "../../package.json";
import {getGitHubApiUri} from "../configuration/configuration";
import {throttling} from "@octokit/plugin-throttling";
import {retry} from "@octokit/plugin-retry";
import {conditionalRequest} from "./conditionalRequests";

export const userAgent = `VS Code GitHub Actions (${version})`;

const GhaOctokit = Octokit.plugin(conditionalRequest, throttling, retry);
export type GhaOctokit = InstanceType<typeof GhaOctokit>;

export function getClient(token: string) {
  return new GhaOctokit({
    auth: token,
    userAgent: userAgent,
    baseUrl: getGitHubApiUri(),
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}.`);

        if (options.request.retryCount === 0) {
          octokit.log.info(`Retrying after ${retryAfter} seconds.`);
          return true;
        }
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(
          `Abuse detected for request ${options.method} ${options.url}. Retrying after ${retryAfter} seconds.`
        );
      }
    }
  });
}
