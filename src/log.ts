import * as vscode from "vscode";

let logger: vscode.LogOutputChannel;

export function init() {
  logger = vscode.window.createOutputChannel("GitHub Actions", {log: true});
}

export function logError(e: Error, ...values: unknown[]) {
  logger.error(e, values);
}

export function logWarn(...values: unknown[]) {
  logger.warn(values.join(" "));
}

export function log(...values: unknown[]) {
  logger.info(values.join(" "));
}

export function logDebug(...values: unknown[]) {
  logger.debug(values.join(" "));
}

export function logTrace(...values: unknown[]) {
  logger.trace(values.join(" "));
}

export function revealLog() {
  logger.show();
}

const octoPrefix = "🐙";

export function createOctokitLogger() {
  return {
    debug: (...args: unknown[]) => logTrace(octoPrefix, "[DBG]", ...args),
    info: (...args: unknown[]) => logTrace(octoPrefix, "[INF]", ...args),
    warn: (...args: unknown[]) => logTrace(octoPrefix, "[WRN]", ...args),
    error: (...args: unknown[]) =>
      logTrace(
        octoPrefix,
        "[ERR]",
        args[0] instanceof Error ? (args[0] as Error) : new Error(String(args[0])),
        ...args.slice(1)
      )
  };
}

