import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Config } from "../types/index.js";
import chalk from "chalk";
import ora, { Ora } from "ora";

/**
 * Clones a specific subdirectory from a GitHub repository
 *
 * @param githubUrl - The GitHub URL to the repository or subdirectory
 * @param destinationPath - The local path where the content should be copied
 * @param spinner - The spinner to update with progress information
 * @returns A boolean indicating success or failure
 */
export async function cloneGitHubSubdirectory(
  githubUrl: string,
  destinationPath: string,
  spinner: Ora,
): Promise<boolean> {
  try {
    // Parse the GitHub URL to extract repo info
    const { owner, repo, branch, subdirectoryPath } = parseGitHubUrl(githubUrl);

    spinner.text = chalk.cyan(`Cloning from ${owner}/${repo}...`);

    // Method 1: Use sparse checkout (more efficient than full clone)
    return await sparseCheckout(
      owner,
      repo,
      branch,
      subdirectoryPath,
      destinationPath,
      spinner,
    );
  } catch (error) {
    spinner.text = chalk.red(`Failed to clone from GitHub: ${error}`);
    return false;
  }
}

/**
 * Uses Git sparse-checkout to efficiently download only the needed subdirectory
 */
async function sparseCheckout(
  owner: string,
  repo: string,
  branch: string,
  subdirectoryPath: string,
  destinationPath: string,
  spinner: Ora,
): Promise<boolean> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilotkit-sparse-"));

  try {
    spinner.text = chalk.cyan("Creating temporary workspace...");

    // Initialize git repo
    execSync("git init", { cwd: tempDir, stdio: "pipe" });

    spinner.text = chalk.cyan("Connecting to repository...");

    // Add remote
    execSync(`git remote add origin https://github.com/${owner}/${repo}.git`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Enable sparse checkout
    execSync("git config core.sparseCheckout true", {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Specify which subdirectory to checkout
    fs.writeFileSync(
      path.join(tempDir, ".git/info/sparse-checkout"),
      subdirectoryPath,
    );

    spinner.text = chalk.cyan("Downloading agent files...");

    // Pull only the specified branch
    execSync(`git pull origin ${branch} --depth=1`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Copy the subdirectory to the destination
    const sourcePath = path.join(tempDir, subdirectoryPath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Subdirectory '${subdirectoryPath}' not found in the repository.`,
      );
    }

    // Ensure destination directory exists
    fs.mkdirSync(destinationPath, { recursive: true });

    spinner.text = chalk.cyan("Installing agent files...");

    // Copy the subdirectory to the destination
    await copyDirectoryAsync(sourcePath, destinationPath);

    return true;
  } finally {
    // Clean up the temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to clean up temporary directory: ${error}`);
    }
  }
}

/**
 * Recursively copies a directory with async pauses
 */
async function copyDirectoryAsync(
  source: string,
  destination: string,
): Promise<void> {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  // Read all files/directories from source
  const entries = fs.readdirSync(source, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectories
      await copyDirectoryAsync(srcPath, destPath);
    } else {
      // Copy files
      fs.copyFileSync(srcPath, destPath);
    }

    // For large directories, add small pauses
    if (entries.length > 10) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}

/**
 * Parses a GitHub URL to extract owner, repo, branch and subdirectory path
 */
function parseGitHubUrl(githubUrl: string): {
  owner: string;
  repo: string;
  branch: string;
  subdirectoryPath: string;
} {
  const url = new URL(githubUrl);

  if (url.hostname !== "github.com") {
    throw new Error("Only GitHub URLs are supported");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts.length < 2) {
    throw new Error("Invalid GitHub URL format");
  }

  const owner = pathParts[0];
  const repo = pathParts[1];
  let branch = "main"; // Default branch
  let subdirectoryPath = "";

  if (
    pathParts.length > 3 &&
    (pathParts[2] === "tree" || pathParts[2] === "blob")
  ) {
    branch = pathParts[3];
    subdirectoryPath = pathParts.slice(4).join("/");
  }

  return { owner, repo, branch, subdirectoryPath };
}

/**
 * Validates if a string is a valid GitHub URL
 */
export function isValidGitHubUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname === "github.com" &&
      parsedUrl.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}
