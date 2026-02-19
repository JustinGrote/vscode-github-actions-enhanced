import * as vscode from "vscode";
import {GithubActionTreeNode} from "../githubActionTreeDataProvider";

export class ErrorNode extends GithubActionTreeNode {
  constructor(message: string) {
    super(message);
  }
}
