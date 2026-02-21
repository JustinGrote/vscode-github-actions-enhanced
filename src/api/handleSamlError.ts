import { AuthenticationSession } from "vscode"

import { getClient, GhaOctokit } from "~/api/api"
import { newSession } from "~/auth/auth"
import { logDebug } from "~/log"

export async function handleSamlError<T>(
  session: AuthenticationSession,
  request: (client: GhaOctokit) => Promise<T>,
): Promise<T> {
  try {
    const client = getClient(session.accessToken)
    return await request(client)
  } catch (error) {
    if ((error as Error).message.includes("Resource protected by organization SAML enforcement.")) {
      logDebug("SAML error, re-authenticating")
      const session = await newSession(
        "Your organization is protected by SAML enforcement. Please sign-in again to continue.",
      )
      const client = getClient(session.accessToken)
      return await request(client)
    } else {
      throw error
    }
  }
}
