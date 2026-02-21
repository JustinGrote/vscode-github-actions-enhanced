import {GitHubAPIUnreachableNode} from "../shared/gitHubApiUnreachableNode"
import {EmptyNode} from "./emptyNode"
import {EnvironmentNode} from "./environmentNode"
import {EnvironmentSecretsNode} from "./environmentSecretsNode"
import {EnvironmentsNode} from "./environmentsNode"
import {EnvironmentVariablesNode} from "./environmentVariablesNode"
import {OrgSecretsNode} from "./orgSecretsNode"
import {OrgVariablesNode} from "./orgVariablesNode"
import {RepoSecretsNode} from "./repoSecretsNode"
import {RepoVariablesNode} from "./repoVariablesNode"
import {SecretNode} from "./secretNode"
import {SecretsNode} from "./secretsNode"
import {VariableNode} from "./variableNode"
import {VariablesNode} from "./variablesNode"

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
