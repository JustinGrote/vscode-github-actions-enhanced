import * as vscode from "vscode"

import {GithubActionTreeNode} from "../githubActionTreeDataProvider"

export class AuthenticationNode extends GithubActionTreeNode {
  constructor() {
    super("Please sign-in in the Accounts menu.")
  }
}
