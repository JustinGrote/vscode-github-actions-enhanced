import {Commands} from "@actions/languageserver/commands"
import {type InitializationOptions, LogLevel} from "@actions/languageserver/initializationOptions"
import {ReadFileRequest, Requests} from "@actions/languageserver/request"
import * as vscode from "vscode"
import {BaseLanguageClient, LanguageClientOptions} from "vscode-languageclient"
import {LanguageClient as BrowserLanguageClient} from "vscode-languageclient/browser"
import {LanguageClient as NodeLanguageClient, type ServerOptions, TransportKind} from "vscode-languageclient/node"

import {userAgent} from "../api/api"
import {getSession} from "../auth/auth"
import {getGitHubApiUri, useEnterprise} from "../configuration/configReader"
import {getGitHubContext} from "../git/repository"
import {log} from "../log"
import {WorkflowSelector} from "./documentSelector"

let client: BaseLanguageClient

/** Helper function determining whether we are executing with node runtime */
export function isNode(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null
}

export async function initLanguageServer(context: vscode.ExtensionContext) {
  const session = await getSession()
  const ghContext = await getGitHubContext()
  const initializationOptions: InitializationOptions = {
    sessionToken: session?.accessToken,
    userAgent: userAgent,
    gitHubApiUrl: useEnterprise() ? getGitHubApiUri() : undefined,
    repos: ghContext?.repos.map(repo => ({
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      workspaceUri: repo.workspaceUri.toString(),
      organizationOwned: repo.organizationOwned,
    })),
    logLevel: PRODUCTION ? LogLevel.Warn : LogLevel.Debug,
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [WorkflowSelector],
    initializationOptions: initializationOptions,
    progressOnInitialization: true,
  }

  // Create the language client and start the client.

  if (isNode()) {
    const serverUri = vscode.Uri.joinPath(context.extensionUri, "dist", "langserver.js")
    const debugOptions = {execArgv: ["--nolazy", "--inspect=6010"]}
    log(`Starting language server with node runtime: ${serverUri.toString()} ${debugOptions.execArgv.join(" ")}`)

    const serverOptions: ServerOptions = {
      run: {module: serverUri.fsPath, transport: TransportKind.ipc},
      debug: {
        module: serverUri.fsPath,
        transport: 1,
        options: debugOptions,
      },
    }

    client = new NodeLanguageClient("actions-language", "GitHub Actions Language Server", serverOptions, clientOptions)
  } else {
    const workerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "web", "langserver.js").toString()
    const worker = new Worker(workerUri)
    worker.onerror = (error: ErrorEvent) => {
      console.error("Language server worker error:", error)
    }
    worker.onmessage = event => {
      if (event.data) {
        console.error("Language server worker message:", event.data)
      }
    }

    client = new BrowserLanguageClient("actions-language", "GitHub Actions Language Server", clientOptions, worker)
  }

  client.onRequest(Requests.ReadFile, async (event: ReadFileRequest) => {
    if (typeof event?.path !== "string") {
      return null
    }

    const uri = vscode.Uri.parse(event?.path)
    const content = await vscode.workspace.fs.readFile(uri)
    return new TextDecoder().decode(content)
  })

  return client.start()
}

export function deactivateLanguageServer(): Promise<void> {
  if (!client) {
    return Promise.resolve()
  }

  return client.stop()
}

export function executeCacheClearCommand(): Promise<void> {
  if (!client) {
    return Promise.resolve()
  }

  return client.sendRequest("workspace/executeCommand", {command: Commands.ClearCache})
}
