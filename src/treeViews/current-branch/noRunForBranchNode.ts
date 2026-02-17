import * as vscode from "vscode";
import { GithubActionTreeNode } from "../githubActionTreeDataProvider";

export class NoRunForBranchNode extends GithubActionTreeNode {
  constructor() {
    super("No runs for current branch");
  }
}
