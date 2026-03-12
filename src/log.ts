import { match, P } from "ts-pattern"
import * as vscode from "vscode"
import packagejson from "../package.json"

let logger: vscode.LogOutputChannel

export function init() {
  logger = vscode.window.createOutputChannel("GitHub Actions", { log: true })
}

export function logError(e: Error, ...values: unknown[]) {
  logger.error(e, values)
}

export function logWarn(...values: unknown[]) {
  logger.warn(values.join(" "))
}

export function log(...values: unknown[]) {
  logger.info(values.join(" "))
}

export function logDebug(...values: unknown[]) {
  logger.debug(values.join(" "))
}

export function logTrace(...values: unknown[]) {
  logger.trace(values.join(" "))
}

export function reportException(e: unknown, prefix?: string) {
  match(e)
  .with(P.instanceOf(Error), (error) => {
    logError(error)
    showUnhandledErrorMessage(error.message, prefix, error)
  })
  .with(P.string, (message) => {
    logError(new Error(message))
    showUnhandledErrorMessage(message, prefix)
  })
  .otherwise((unknown) => {
    logError(new Error("Unknown object thrown: " + JSON.stringify(unknown)))
    showUnhandledErrorMessage(`Unknown object thrown: ${JSON.stringify(unknown)}`, prefix)
  })
  // Stop the execution
  throw e
}

function showUnhandledErrorMessage(message: string, prefix?: string, error?: Error) {
  const fullMessage = `GitHub Actions had an unhandled exception: ${message}. See the output channel for more details.`
  vscode.window.showErrorMessage(fullMessage, "Show Output", "Restart Extension Host", "Report Issue")
    .then((selection) => {
      if (selection === "Show Output") {
        revealLog()
      } else if (selection === "Restart Extension Host") {
        vscode.commands.executeCommand("workbench.action.restartExtensionHost")
      } else if (selection === "Report Issue") {
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
          extensionId: `${packagejson.publisher}.${packagejson.name}`,
          issueTitle: `Unhandled Exception: ${message}`,
          data: JSON.stringify(error)
        })
      }
    })
}

export function revealLog() {
  logger.show()
}

const octoPrefix = "🐙"

export function createOctokitLogger() {
  return {
    debug: (...args: unknown[]) => {
      // Omit request logs, this is handled lower by the REST logger
      if (String(args[0]) === "request") return
      logTrace(octoPrefix, "[DBG]", ...args)
    },
    info: (...args: unknown[]) => logTrace(octoPrefix, "[INF]", ...args),
    warn: (...args: unknown[]) => logTrace(octoPrefix, "[WRN]", ...args),
    error: (...args: unknown[]) => {
      // 304 Not Modified errors are expected in conditional requests, and are not errors.
      const firstArgAsString = String(args[0])
      if (firstArgAsString.includes("304 with id")) {
        logTrace(octoPrefix, "[DBG]", firstArgAsString)
        return
      }

      const error = args[0] instanceof Error ? (args[0] as Error) : new Error(firstArgAsString)
      logTrace(octoPrefix, "[ERR]", error, ...args.slice(1))
    },
  }
}
