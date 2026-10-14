import { readFile } from "node:fs/promises";

// Linux PID reuse after container replacement must not turn a stale lease into
// a live owner. Persist kernel boot identity AND process start ticks.
export async function processOwner(pid = process.pid) {
  if (process.platform !== "linux") return { pid };
  const [boot, stat] = await Promise.all([
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readFile(`/proc/${pid}/stat`, "utf8"),
  ]);
  return {
    pid,
    bootId: boot.trim(),
    startTicks: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
  };
}

export async function ownerAlive(owner) {
  try {
    process.kill(owner.pid, 0);
    if (!owner.bootId || !owner.startTicks) return true;
    const current = await processOwner(owner.pid);
    return (
      owner.bootId === current.bootId && owner.startTicks === current.startTicks
    );
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes(error.code)) return false;
    throw error;
  }
}
