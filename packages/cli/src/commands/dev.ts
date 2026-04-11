import { Config, Flags } from "@oclif/core";
import inquirer from "inquirer";
import { createId } from "@paralleldrive/cuid2";
import ora, { Ora } from "ora";
import chalk from "chalk";

import { AuthService } from "../services/auth.service.js";
import { createTRPCClient } from "../utils/trpc.js";
import {
  detectRemoteEndpointType,
  getHumanReadableEndpointType,
  RemoteEndpointType,
} from "../utils/detect-endpoint-type.utils.js";
import { TunnelService } from "../services/tunnel.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { BaseCommand } from "./base-command.js";

const DEFAULT_CLOUD_BASE_URL = "https://cloud.copilotkit.ai";
const CLOUD_BASE_URL =
  process.env.COPILOT_CLOUD_BASE_URL ?? DEFAULT_CLOUD_BASE_URL;

export default class Dev extends BaseCommand {
  static override flags = {
    port: Flags.string({ description: "port", required: true }),
    project: Flags.string({
      description: "project ID (can be found in the Copilot Cloud dashboard)",
    }),
  };

  static override description =
    "Start local development for a CopilotKit project";
  static override examples = [
    "<%= config.bin %> <%= command.id %> --port 8000 --project proj_mv3laowus0lz11kklo57bdr6",
  ];

  private trpcClient: ReturnType<typeof createTRPCClient> | null = null;
  private copilotCloudTunnelId: string | null = null;

  constructor(
    argv: string[],
    config: Config,
    private authService = new AuthService(),
    private tunnelService = new TunnelService(),
  ) {
    super(argv, config);
  }

  private async pingTunnelRecursively(): Promise<void> {
    if (!this.copilotCloudTunnelId) {
      return;
    }

    try {
      await this.trpcClient!.pingLocalTunnel.query({
        localTunnelId: this.copilotCloudTunnelId!,
      });
    } catch (error: any) {
      if (error?.data?.code === "NOT_FOUND") {
        this.gracefulError(error.message);
      } else {
        this.gracefulError(
          "Failed to ping tunnel. The connection may have been lost.",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
    await this.pingTunnelRecursively();
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Dev);

    // Check authentication
    const { cliToken, organization, user } =
      await this.authService.requireLogin(this, "general");
    const analytics = new AnalyticsService({
      userId: user.id,
      organizationId: organization.id,
      email: user.email,
    });

    this.trpcClient = createTRPCClient(cliToken);

    const availableProjects = await this.trpcClient.listOrgProjects.query({
      orgId: organization.id,
    });
    let selectedProjectId: string | null = null;

    // Get project ID
    if (flags.project) {
      if (
        !availableProjects.some((project: any) => project.id === flags.project)
      ) {
        this.log(chalk.red(`Project with ID ${flags.project} not found`));
        process.exit(1);
      }

      selectedProjectId = flags.project;
      this.log(chalk.green(`✅ Selected project ${selectedProjectId}`));
    } else {
      const { projectId } = await inquirer.prompt([
        {
          name: "projectId",
          type: "list",
          message: "Select a project",
          choices: availableProjects.map((project: any) => ({
            value: project.id,
            name: `${project.name} (ID: ${project.id})${availableProjects.length === 1 ? " (press Enter to confirm)" : ""}`,
          })),
        },
      ]);

      selectedProjectId = projectId;
    }

    // Remote endpoint type detection
    const { type: remoteEndpointType } = await detectRemoteEndpointType(
      `http://localhost:${flags.port}`,
    );

    if (remoteEndpointType === RemoteEndpointType.Invalid) {
      return this.gracefulError(
        `Invalid remote endpoint. Please ensure you are running a compatible endpoint at port ${flags.port} and try again.`,
      );
    }

    const humanReadableRemoteEndpointType =
      getHumanReadableEndpointType(remoteEndpointType);

    await analytics.track({
      event: "cli.dev.initiatied",
      properties: {
        port: flags.port,
        projectId: selectedProjectId!,
        endpointType: remoteEndpointType,
      },
    });

    this.log(
      chalk.green(`✅ ${humanReadableRemoteEndpointType} endpoint detected`),
    );
    const spinner = ora("Creating tunnel...\n").start();

    const tunnelId = createId();

    // Starting tunnel
    const setupTunnel = this.setupTunnel({
      tunnelId,
      port: parseInt(flags.port),
      subdomain: createId(),
      onSuccess: async ({ url, id }) => {
        // Print tunnel info
        this.log("\nTunnel Information:\n");
        this.log(`${chalk.bold.cyan("• Tunnel URL:\t\t")} ${chalk.white(url)}`);
        this.log(
          `${chalk.bold.cyan("• Endpoint Type:\t")} ${chalk.white(humanReadableRemoteEndpointType)}`,
        );
        this.log(
          `${chalk.bold.cyan("• Project:\t\t")} ${chalk.white(`${CLOUD_BASE_URL}/projects/${selectedProjectId!}`)}`,
        );
        this.log(chalk.yellow("\nPress Ctrl+C to stop the tunnel"));
        this.log("\n");

        spinner.text = "Linking local tunnel to Copilot Cloud...";

        // Report to Cloud
        const { localTunnelId } =
          await this.trpcClient!.reportRemoteEndpointLocalTunnel.mutate({
            tunnelId: id,
            projectId: selectedProjectId!,
            endpointType:
              remoteEndpointType === RemoteEndpointType.CopilotKit
                ? "CopilotKit"
                : "LangGraphCloud",
            tunnelUrl: url,
            port: parseInt(flags.port),
          });

        this.copilotCloudTunnelId = localTunnelId;

        await analytics.track({
          event: "cli.dev.tunnel.created",
          properties: {
            tunnelId: localTunnelId,
            port: flags.port,
            projectId: selectedProjectId!,
            endpointType: remoteEndpointType,
          },
        });

        spinner.color = "green";
        spinner.text = "🚀 Local tunnel is live and linked to Copilot Cloud!\n";
        spinner.succeed();

        await this.pingTunnelRecursively();
      },
      onTunnelClose: async ({ id }) => {
        if (this.copilotCloudTunnelId) {
          await analytics.track({
            event: "cli.dev.tunnel.closed",
            properties: {
              tunnelId: id,
            },
          });

          await this.trpcClient!.deleteLocalTunnel.mutate({
            localTunnelId: this.copilotCloudTunnelId!,
          });
          this.copilotCloudTunnelId = null;
        }
      },
      spinner,
    });

    [await setupTunnel];
  }

  private async setupTunnel({
    port,
    subdomain,
    onSuccess,
    onTunnelClose,
    spinner,
    tunnelId,
  }: {
    port: number;
    subdomain?: string;
    onSuccess: (params: { url: string; id: string }) => Promise<void>;
    onTunnelClose: (params: { id: string }) => Promise<void>;
    spinner: Ora;
    tunnelId: string;
  }) {
    const TUNNEL_TIMEOUT = 15000; // 15 seconds
    const CONNECTION_TEST_TIMEOUT = 5000; // 5 seconds

    // First, test if the local port is accessible
    spinner.text = `Testing connection to localhost:${port}...`;
    try {
      const testResponse = await Promise.race([
        fetch(`http://localhost:${port}`, { method: "HEAD" }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Connection timeout")),
            CONNECTION_TEST_TIMEOUT,
          ),
        ),
      ]);
    } catch (error) {
      spinner.fail();
      return this.gracefulError(
        `Cannot connect to localhost:${port}. Please ensure your application is running on port ${port} and try again.`,
      );
    }

    spinner.text = "Creating tunnel...";

    try {
      // Create the tunnel with timeout
      const tunnel = await Promise.race([
        this.tunnelService.create({
          port,
          subdomain: tunnelId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Tunnel creation timeout")),
            TUNNEL_TIMEOUT,
          ),
        ),
      ]);

      // Handle tunnel events
      tunnel.on("request", (info: any) => {
        this.log(
          `${chalk.green("➜")} ${chalk.white(new Date().toISOString())} - ${info.method} ${info.path}`,
        );
      });

      tunnel.on("error", (err: any) => {
        this.gracefulError(chalk.red(`Tunnel error: ${err.message}`));
      });

      tunnel.on("close", async () => {
        this.log(chalk.yellow("\nTunnel closed"));
        await onTunnelClose({ id: tunnelId });
        process.exit(0);
      });

      // Keep the process alive until Ctrl+C
      await Promise.all([
        new Promise<void>(() => {
          process.on("SIGINT", async () => {
            this.log("\nShutting down tunnel...");
            await onTunnelClose({ id: tunnelId });
            tunnel.close();
            process.exit(0);
          });

          process.on("SIGTERM", async () => {
            this.log("\nShutting down tunnel...");
            await onTunnelClose({ id: tunnelId });
            tunnel.close();
            process.exit(0);
          });
        }),
        onSuccess({ url: tunnel.url, id: tunnelId }),
      ]);
    } catch (error: any) {
      spinner.fail();
      if (error.message === "Tunnel creation timeout") {
        return this.gracefulError(
          `Unable to establish tunnel connection after ${TUNNEL_TIMEOUT / 1000} seconds.\n\n` +
            `This usually means:\n` +
            `• Network connectivity issues\n` +
            `• Tunnel service is temporarily unavailable\n` +
            `• Firewall blocking outbound connections\n\n` +
            `Please try:\n` +
            `1. Check your internet connection\n` +
            `2. Try again in a few moments\n`,
        );
      } else if (error.message === "Connection timeout") {
        return this.gracefulError(
          `Cannot connect to localhost:${port}. Please ensure your application is running on port ${port} and try again.`,
        );
      } else {
        return this.gracefulError(`Failed to create tunnel: ${error.message}`);
      }
    }
  }
}
