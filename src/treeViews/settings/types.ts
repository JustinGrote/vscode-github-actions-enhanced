import { EmptyNode } from "~/treeViews/settings/emptyNode"
import { EnvironmentNode } from "~/treeViews/settings/environmentNode"
import { EnvironmentSecretsNode } from "~/treeViews/settings/environmentSecretsNode"
import { EnvironmentsNode } from "~/treeViews/settings/environmentsNode"
import { EnvironmentVariablesNode } from "~/treeViews/settings/environmentVariablesNode"
import { OrgSecretsNode } from "~/treeViews/settings/orgSecretsNode"
import { OrgVariablesNode } from "~/treeViews/settings/orgVariablesNode"
import { RepoSecretsNode } from "~/treeViews/settings/repoSecretsNode"
import { RepoVariablesNode } from "~/treeViews/settings/repoVariablesNode"
import { SecretNode } from "~/treeViews/settings/secretNode"
import { SecretsNode } from "~/treeViews/settings/secretsNode"
import { VariableNode } from "~/treeViews/settings/variableNode"
import { VariablesNode } from "~/treeViews/settings/variablesNode"
import { GitHubAPIUnreachableNode } from "~/treeViews/shared/gitHubApiUnreachableNode"

export type SettingsExplorerNode =
  | SecretsNode
  | SecretNode
  | EnvironmentsNode
  | EnvironmentNode
  | EnvironmentSecretsNode
  | EnvironmentVariablesNode
  | OrgSecretsNode
  | OrgVariablesNode
  | RepoSecretsNode
  | RepoVariablesNode
  | VariableNode
  | VariablesNode
  | EmptyNode
  | GitHubAPIUnreachableNode
