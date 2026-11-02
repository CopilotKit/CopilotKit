import { afterEach, describe, expect, it, vi } from "vitest";
import { runCaptured } from "./run-captured.js";

const PRINT_BOTH =
  'process.stdout.write("out\\n"); process.stderr.write("err\\n");';

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCaptured", () => {
  it("captures stdout and stderr without echoing them", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const output = await runCaptured(process.execPath, ["-e", PRINT_BOTH]);

    expect(output).toContain("out\n");
    expect(output).toContain("err\n");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("echoes output as it arrives when streaming, and still captures it", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const output = await runCaptured(process.execPath, ["-e", PRINT_BOTH], {
      stream: true,
    });

    expect(output).toContain("out\n");
    expect(String(stdout.mock.calls[0][0])).toBe("out\n");
    expect(String(stderr.mock.calls[0][0])).toBe("err\n");
  });

  it("puts the captured output in the error when the command fails", async () => {
    await expect(
      runCaptured(process.execPath, [
        "-e",
        'console.error("npm error code E403"); process.exit(1);',
      ]),
    ).rejects.toThrow(/exit 1[\s\S]*npm error code E403/);
  });
});
