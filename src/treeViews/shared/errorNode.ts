import { GithubActionTreeNode } from "~/treeViews/githubActionTreeDataProvider"

export class ErrorNode extends GithubActionTreeNode {
  constructor(message: string) {
    super(message)
  }
}
