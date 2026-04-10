import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

const MAX_STACK_NAME_BASE_LENGTH = 35;

export type DeploymentType = "docker" | "zip";

/**
 * Network mode for the AgentCore Runtime.
 * - PUBLIC: Runtime is accessible over the public internet (default).
 * - VPC: Runtime is deployed into a user-provided VPC for private network isolation.
 */
export type NetworkMode = "PUBLIC" | "VPC";

/**
 * VPC configuration for deploying the AgentCore Runtime into an existing VPC.
 * Required when network_mode is "VPC".
 */
export interface VpcConfig {
  /** The ID of the existing VPC to deploy into (e.g. "vpc-0abc1234def56789a"). */
  vpc_id: string;
  /** List of subnet IDs within the VPC where the runtime will be placed. */
  subnet_ids: string[];
  /** Optional list of security group IDs. If omitted, a default security group is created. */
  security_group_ids?: string[];
}

export interface AppConfig {
  stack_name_base: string;
  admin_user_email?: string | null;
  backend: {
    pattern: string;
    deployment_type: DeploymentType;
    /** Network mode for the AgentCore Runtime. Defaults to "PUBLIC". */
    network_mode: NetworkMode;
    /** VPC configuration. Required when network_mode is "VPC". */
    vpc?: VpcConfig;
  };
}

export class ConfigManager {
  private config: AppConfig;

  constructor(configFile: string) {
    this.config = this._loadConfig(configFile);
  }

  private _loadConfig(configFile: string): AppConfig {
    const configPath = path.join(__dirname, "..", "..", "..", configFile);

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Configuration file ${configPath} does not exist. Please create config.yaml file.`,
      );
    }

    try {
      const fileContent = fs.readFileSync(configPath, "utf8");
      const parsedConfig = yaml.parse(fileContent) as AppConfig;

      const deploymentType = parsedConfig.backend?.deployment_type || "docker";
      if (deploymentType !== "docker" && deploymentType !== "zip") {
        throw new Error(
          `Invalid deployment_type '${deploymentType}'. Must be 'docker' or 'zip'.`,
        );
      }

      const stackNameBase = parsedConfig.stack_name_base;
      if (!stackNameBase) {
        throw new Error("stack_name_base is required in config.yaml");
      }
      if (stackNameBase.length > MAX_STACK_NAME_BASE_LENGTH) {
        throw new Error(
          `stack_name_base '${stackNameBase}' is too long (${stackNameBase.length} chars). ` +
            `Maximum length is ${MAX_STACK_NAME_BASE_LENGTH} characters due to AWS AgentCore runtime naming constraints.`,
        );
      }

      // Validate network_mode if provided
      const networkMode = parsedConfig.backend?.network_mode || "PUBLIC";
      if (networkMode !== "PUBLIC" && networkMode !== "VPC") {
        throw new Error(
          `Invalid network_mode '${networkMode}'. Must be 'PUBLIC' or 'VPC'.`,
        );
      }

      // Validate VPC configuration when network_mode is VPC
      const vpcConfig = parsedConfig.backend?.vpc;
      if (networkMode === "VPC") {
        if (!vpcConfig) {
          throw new Error(
            "backend.vpc configuration is required when network_mode is 'VPC'.",
          );
        }
        if (!vpcConfig.vpc_id) {
          throw new Error(
            "backend.vpc.vpc_id is required when network_mode is 'VPC'.",
          );
        }
        if (!vpcConfig.subnet_ids || vpcConfig.subnet_ids.length === 0) {
          throw new Error(
            "backend.vpc.subnet_ids must contain at least one subnet ID when network_mode is 'VPC'.",
          );
        }
      }

      return {
        stack_name_base: stackNameBase,
        admin_user_email: parsedConfig.admin_user_email || null,
        backend: {
          pattern: parsedConfig.backend?.pattern || "langgraph-single-agent",
          deployment_type: deploymentType,
          network_mode: networkMode,
          vpc: vpcConfig,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to parse configuration file ${configPath}: ${error}`,
        { cause: error },
      );
    }
  }

  public getProps(): AppConfig {
    return this.config;
  }

  public get(key: string, defaultValue?: any): any {
    const keys = key.split(".");
    let value: any = this.config;

    for (const k of keys) {
      if (typeof value === "object" && value !== null && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }
}
