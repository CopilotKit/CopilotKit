// @ts-ignore
import Conf from "conf";
import cors from "cors";
import express from "express";
import crypto from "node:crypto";
import open from "open";
import getPort from "get-port";
import ora from "ora";
import chalk from "chalk";
import inquirer from "inquirer";
import { Command } from "@oclif/core";
import { createTRPCClient } from "../utils/trpc.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { BaseCommand } from "../commands/base-command.js";

interface LoginResponse {
  cliToken: string;
  user: {
    email: string;
    id: string;
  };
  organization: {
    id: string;
  };
}

export class AuthService {
  private readonly config = new Conf({ projectName: "CopilotKitCLI" });
  private readonly COPILOT_CLOUD_BASE_URL =
    process.env.COPILOT_CLOUD_BASE_URL || "https://cloud.copilotkit.ai";

  getToken(): string | undefined {
    return this.config.get("cliToken") as string | undefined;
  }

  getCLIToken(): string | undefined {
    const cliToken = this.config.get("cliToken") as string | undefined;
    return cliToken;
  }

  async logout(cmd: BaseCommand): Promise<void> {
    this.config.delete("cliToken");
  }

  async requireLogin(
    cmd: Command,
    context?: "cloud-features" | "general",
  ): Promise<LoginResponse> {
    let cliToken = this.getCLIToken();
    // Check authentication
    if (!cliToken) {
      try {
        let shouldLogin = true;

        // For cloud features, automatically proceed with login
        // For general usage, ask for confirmation
        if (context !== "cloud-features") {
          const response = await inquirer.prompt([
            {
              name: "shouldLogin",
              type: "confirm",
              message:
                "🪁 You are not yet authenticated. Authenticate with Copilot Cloud? (press Enter to confirm)",
              default: true,
            },
          ]);
          shouldLogin = response.shouldLogin;
        }

        if (shouldLogin) {
          // Show different message for cloud features vs general usage
          if (context === "cloud-features") {
            cmd.log(
              chalk.cyan("\n🚀 Setting up Copilot Cloud authentication...\n"),
            );
          }
          const loginResult = await this.login({ exitAfterLogin: false });
          cliToken = loginResult.cliToken;
          return loginResult;
        } else {
          cmd.error("Authentication required to proceed.");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
          cmd.error(chalk.yellow("\nAuthentication cancelled"));
        }

        throw error;
      }
    }

    let me;

    const trpcClient = createTRPCClient(cliToken);
    try {
      me = await trpcClient.me.query();
    } catch (error) {
      // Token is invalid/expired, trigger new login
      cmd.log(
        chalk.yellow("Your authentication has expired. Re-authenticating..."),
      );
      try {
        const loginResult = await this.login({ exitAfterLogin: false });
        return loginResult;
      } catch (loginError) {
        cmd.log(
          chalk.red(
            "Could not authenticate with Copilot Cloud. Please run: npx copilotkit@latest login",
          ),
        );
        process.exit(1);
      }
    }

    if (!me.organization || !me.user) {
      cmd.error("Authentication required to proceed.");
    }

    return { cliToken, user: me.user, organization: me.organization };
  }

  async login(
    { exitAfterLogin }: { exitAfterLogin?: boolean } = { exitAfterLogin: true },
  ): Promise<LoginResponse> {
    const spinner = ora("🪁 Opening browser for authentication...").start();
    let analytics: AnalyticsService;
    analytics = new AnalyticsService();

    const app = express();
    app.use(cors());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    const port = await getPort();
    const state = crypto.randomBytes(16).toString("hex");

    return new Promise(async (resolve, reject) => {
      const server = app.listen(port, () => {});

      await analytics.track({
        event: "cli.login.initiated",
        properties: {},
      });

      spinner.text = "🪁 Waiting for browser authentication to complete...";

      app.post("/callback", async (req, res) => {
        const { cliToken, user, organization } = req.body;

        if (state !== req.query.state) {
          res.status(401).json({ message: "Invalid state" });
          spinner.fail("Invalid state");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        analytics = new AnalyticsService({
          userId: user.id,
          organizationId: organization.id,
          email: user.email,
        });
        await analytics.track({
          event: "cli.login.success",
          properties: {
            organizationId: organization.id,
            userId: user.id,
            email: user.email,
          },
        });

        this.config.set("cliToken", cliToken);
        res.status(200).json({ message: "Callback called" });
        spinner.succeed(
          `🪁 Successfully logged in as ${chalk.hex("#7553fc")(user.email)}`,
        );
        if (exitAfterLogin) {
          process.exit(0);
        } else {
          server.close();
          resolve({ cliToken, user, organization });
        }
      });

      open(
        `${this.COPILOT_CLOUD_BASE_URL}/cli-auth?callbackUrl=http://localhost:${port}/callback&state=${state}`,
      );
    });
  }
}
