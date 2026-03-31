import * as fs from "fs/promises";
import ora from "ora";
import * as path from "path";

export async function addCrewInputs(url: string, token: string) {
  try {
    const spinner = ora("Analyzing crew inputs...").start();
    // Get inputs from the crew API
    const inputs = await getCrewInputs(url, token);
    spinner.text = "Adding inputs to app/copilotkit/page.tsx...";

    // Path to the file we need to modify
    let filePath = path.join(process.cwd(), "app", "copilotkit", "page.tsx");

    // check if non-src file exists
    try {
      await fs.access(filePath);
    } catch {
      filePath = path.join(
        process.cwd(),
        "src",
        "app",
        "copilotkit",
        "page.tsx",
      );
    }

    // check if src file exists
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(
        "app/copilotkit/page.tsx and src/app/copilotkit/page.tsx not found",
      );
    }

    // Read the file content
    let fileContent = await fs.readFile(filePath, "utf8");

    // Replace all instances of "YOUR_INPUTS_HERE" with the inputs array as a string
    const inputsString = JSON.stringify(inputs);
    fileContent = fileContent.replace(
      /\[["']YOUR_INPUTS_HERE["']\]/g,
      inputsString,
    );

    // Write the updated content back to the file
    await fs.writeFile(filePath, fileContent, "utf8");

    spinner.succeed(
      "Successfully added crew inputs to app/copilotkit/page.tsx",
    );
  } catch (error) {
    console.error("Error updating crew inputs:", error);
    throw error;
  }
}

async function getCrewInputs(url: string, token: string): Promise<string[]> {
  const response = await fetch(`${url.trim()}/inputs`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch inputs: ${response.statusText}`);
  }

  const data = (await response.json()) as { inputs: string[] };
  return data.inputs;
}
