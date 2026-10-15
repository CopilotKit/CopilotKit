import { homedir } from "node:os";
import { join } from "node:path";
import { installSshSeed } from "./ssh-seed.mjs";
import { main } from "./server.mjs";

try {
  await installSshSeed({
    directory: join(homedir(), ".ssh"),
    privateKeyBase64: process.env.RICH_RUNNER_SSH_PRIVATE_KEY_B64,
    publicKey: process.env.RICH_RUNNER_SSH_PUBLIC_KEY,
    knownHosts: process.env.RICH_RUNNER_SSH_KNOWN_HOSTS,
  });
  delete process.env.RICH_RUNNER_SSH_PRIVATE_KEY_B64;
  await main();
} catch {
  console.error(
    "Railway runner startup failed; check private SSH/bootstrap configuration",
  );
  process.exitCode = 1;
}
