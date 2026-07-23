/**
 * resource-gauges.ts — point-in-time OS resource gauges for the harness's
 * long-lived chromium pool, intended as PERMANENT instrumentation around
 * `BrowserPool`'s acquire/release/recycle/relaunch cycle.
 *
 * WHY: the BrowserPool wedges under d6 launch storms — every `chromium.launch()`
 * throws `pthread_create: Resource temporarily unavailable (errno 11)` →
 * "Target page, context or browser has been closed" and the pool never recovers
 * without a container restart. The PROVEN root cause is OS thread/PID exhaustion
 * against the container cgroup `pids.max` ceiling (counts THREADS, not just
 * processes): a d6 burst (max_concurrency:8 → ~32 contexts → ~32 renderers ×
 * ~15 threads ≈ +480 on top of the ~377 idle baseline) peaks ~850-900, and a
 * concurrent recovery-relaunch pushes it over the platform-fixed `pids.max=1000`
 * ceiling. To make that observable — so a burst approaching `pids.max` is
 * visible in the logs and an EAGAIN correlates to a measured `pids.current` near
 * `pids.max` — we sample a cheap gauge snapshot on every pool launch / heal
 * failure and at probe-tick boundaries.
 *
 * The HEADLINE gauges are the cgroup PID counters (`pids.current` / `pids.max`)
 * and the process-tree thread count; the rest (FDs, RSS, /dev/shm, /tmp inodes,
 * /tmp space) are kept so the differential that REFUTED every other candidate
 * stays observable in production.
 *
 * All gauges are read from Linux `/proc` + `/sys/fs/cgroup` + `statvfs`-
 * equivalents via `df`. They degrade gracefully (NaN / -1) on non-Linux hosts so
 * the module is safe to import anywhere; the meaningful numbers come from inside
 * the Linux container (which is where staging runs and where the wedge happens).
 *
 * Cost: a handful of readdir/statfs/readfile syscalls + two short `df` execs.
 * Cheap enough to fire on every launch / heal failure.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

export interface ResourceGauges {
  /** Wall-clock ISO timestamp of the sample. */
  ts: string;
  /** Open file descriptors held by THIS process (sockets, pipes, files). */
  selfFdCount: number;
  /** Total threads across the whole process tree rooted at this PID
   *  (self + every descendant, incl. chromium renderers). */
  treeThreadCount: number;
  /** Total processes (PIDs) in the tree rooted at this PID. */
  treeProcCount: number;
  /** Count of zombie/defunct processes in the tree (state Z). */
  zombieCount: number;
  /** Resident set size of THIS process (MB). */
  selfRssMb: number;
  /** Summed RSS across the whole process tree (MB) — self + descendants. */
  treeRssMb: number;
  /** cgroup `pids.current` — live thread/process count charged against the
   *  cgroup PID controller (THE headline signal; the ceiling that wedges). -1
   *  if unavailable (non-Linux, no cgroup PID controller). */
  cgroupPidsCurrent: number;
  /** cgroup `pids.max` — the PID/thread ceiling the runtime fixed for this
   *  container. `Infinity`-equivalent "max" is reported as -1 (unbounded);
   *  -1 also signals unavailable. */
  cgroupPidsMax: number;
  /** /dev/shm usage percent (0..100); -1 if unavailable. */
  devShmUsedPct: number;
  /** /tmp inode usage percent (0..100); -1 if unavailable. */
  tmpInodeUsedPct: number;
  /** /tmp inodes used (absolute); -1 if unavailable. */
  tmpInodesUsed: number;
  /** /tmp inodes free (absolute); -1 if unavailable. */
  tmpInodesFree: number;
  /** /tmp disk-space usage percent (0..100); -1 if unavailable. */
  tmpSpaceUsedPct: number;
  /** /tmp disk-space free (MB); -1 if unavailable. */
  tmpSpaceFreeMb: number;
  /** Count of `playwright_*` + `playwright-artifacts-*` dirs under tmpdir(). */
  playwrightTmpDirs: number;
}

/** Read this process's open-FD count via /proc/self/fd. */
function readSelfFdCount(): number {
  try {
    return readdirSync("/proc/self/fd").length;
  } catch {
    return -1;
  }
}

/**
 * Read the cgroup PID controller's current/max counters. THE headline gauge:
 * the wedge is exhaustion of this ceiling. Tries cgroup v2 first
 * (`/sys/fs/cgroup/pids.{current,max}`), then falls back to cgroup v1
 * (`/sys/fs/cgroup/pids/pids.{current,max}`). `pids.max` of the literal string
 * "max" means unbounded → reported as -1. Any read failure → -1 (non-Linux, no
 * PID controller mounted).
 */
export function readCgroupPids(
  readFileImpl: (path: string) => string = (p) => readFileSync(p, "utf8"),
): { current: number; max: number } {
  const candidates: Array<{ current: string; max: string }> = [
    // cgroup v2 (unified hierarchy)
    { current: "/sys/fs/cgroup/pids.current", max: "/sys/fs/cgroup/pids.max" },
    // cgroup v1 (legacy)
    {
      current: "/sys/fs/cgroup/pids/pids.current",
      max: "/sys/fs/cgroup/pids/pids.max",
    },
  ];
  for (const c of candidates) {
    try {
      const currentRaw = readFileImpl(c.current).trim();
      const maxRaw = readFileImpl(c.max).trim();
      const current = Number(currentRaw);
      // "max" (cgroup's sentinel for unbounded) → -1.
      const max = maxRaw === "max" ? -1 : Number(maxRaw);
      if (Number.isFinite(current)) {
        return { current, max: Number.isFinite(max) ? max : -1 };
      }
    } catch {
      // try next candidate
    }
  }
  return { current: -1, max: -1 };
}

/**
 * Walk /proc once, collecting every PID, summing per-pid thread counts and RSS,
 * counting zombies, and restricting to the tree rooted at `rootPid` (self +
 * transitive children). One pass over /proc — no `ps` fork per call.
 */
function readProcTree(rootPid: number): {
  treeThreadCount: number;
  treeProcCount: number;
  zombieCount: number;
  selfRssMb: number;
  treeRssMb: number;
} {
  const pageSize = 4096; // statm fields are in pages; Linux default 4KiB.
  type Stat = {
    ppid: number;
    threads: number;
    state: string;
    rssBytes: number;
  };
  const stats = new Map<number, Stat>();
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return {
      treeThreadCount: -1,
      treeProcCount: -1,
      zombieCount: -1,
      selfRssMb: -1,
      treeRssMb: -1,
    };
  }

  for (const pidStr of pids) {
    const pid = Number(pidStr);
    try {
      // /proc/<pid>/stat: comm may contain spaces/parens; split on the LAST
      // ')' so fields after comm align regardless of comm content.
      const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
      const rparen = raw.lastIndexOf(")");
      const after = raw.slice(rparen + 2).split(" ");
      // After comm: state(0) ppid(1) ... num_threads is post-comm index 17.
      const state = after[0];
      const ppid = Number(after[1]);
      const threads = Number(after[17]);
      let rssBytes = 0;
      try {
        const statm = readFileSync(`/proc/${pid}/statm`, "utf8").split(" ");
        rssBytes = Number(statm[1]) * pageSize; // field 2 = resident pages
      } catch {
        rssBytes = 0;
      }
      stats.set(pid, { ppid, threads, state, rssBytes });
    } catch {
      // Process vanished between readdir and read — skip.
    }
  }

  // Build child adjacency and walk the tree from rootPid.
  const childrenOf = new Map<number, number[]>();
  for (const [pid, s] of stats) {
    const arr = childrenOf.get(s.ppid) ?? [];
    arr.push(pid);
    childrenOf.set(s.ppid, arr);
  }

  let treeThreadCount = 0;
  let treeProcCount = 0;
  let zombieCount = 0;
  let treeRssBytes = 0;
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const s = stats.get(pid);
    if (!s) continue;
    treeProcCount += 1;
    treeThreadCount += Number.isFinite(s.threads) ? s.threads : 0;
    treeRssBytes += s.rssBytes;
    if (s.state === "Z") zombieCount += 1;
    for (const c of childrenOf.get(pid) ?? []) stack.push(c);
  }

  const selfStat = stats.get(rootPid);
  const selfRssMb = selfStat ? selfStat.rssBytes / (1024 * 1024) : -1;

  return {
    treeThreadCount,
    treeProcCount,
    zombieCount,
    selfRssMb: Math.round(selfRssMb),
    treeRssMb: Math.round(treeRssBytes / (1024 * 1024)),
  };
}

/** Parse `df` (1K blocks) for a mount: returns {usedPct, freeMb}. */
function readDfSpace(path: string): { usedPct: number; freeMb: number } {
  try {
    const out = execFileSync("df", ["-kP", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n").pop()!;
    const cols = line.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const available = Number(cols[3]);
    const capacity = Number(cols[4].replace("%", ""));
    return { usedPct: capacity, freeMb: Math.round(available / 1024) };
  } catch {
    return { usedPct: -1, freeMb: -1 };
  }
}

/** Parse `df -i` for a mount: returns {usedPct, used, free}. */
function readDfInodes(path: string): {
  usedPct: number;
  used: number;
  free: number;
} {
  try {
    const out = execFileSync("df", ["-iP", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n").pop()!;
    const cols = line.split(/\s+/);
    // Filesystem Inodes IUsed IFree IUse% Mounted
    const used = Number(cols[2]);
    const free = Number(cols[3]);
    const usedPct = Number(cols[4].replace("%", ""));
    return { usedPct, used, free };
  } catch {
    return { usedPct: -1, used: -1, free: -1 };
  }
}

/** Count playwright_* + playwright-artifacts-* dirs under tmpdir(). */
function countPlaywrightTmpDirs(): number {
  try {
    return readdirSync(tmpdir()).filter(
      (n) =>
        n.startsWith("playwright_") || n.startsWith("playwright-artifacts-"),
    ).length;
  } catch {
    return -1;
  }
}

/** Take one full gauge snapshot. */
export function sampleResourceGauges(): ResourceGauges {
  const tree = readProcTree(process.pid);
  const cgroupPids = readCgroupPids();
  const shm = readDfSpace("/dev/shm");
  const tmpInodes = readDfInodes(tmpdir());
  const tmpSpace = readDfSpace(tmpdir());
  return {
    ts: new Date().toISOString(),
    selfFdCount: readSelfFdCount(),
    treeThreadCount: tree.treeThreadCount,
    treeProcCount: tree.treeProcCount,
    zombieCount: tree.zombieCount,
    selfRssMb: tree.selfRssMb,
    treeRssMb: tree.treeRssMb,
    cgroupPidsCurrent: cgroupPids.current,
    cgroupPidsMax: cgroupPids.max,
    devShmUsedPct: shm.usedPct,
    tmpInodeUsedPct: tmpInodes.usedPct,
    tmpInodesUsed: tmpInodes.used,
    tmpInodesFree: tmpInodes.free,
    tmpSpaceUsedPct: tmpSpace.usedPct,
    tmpSpaceFreeMb: tmpSpace.freeMb,
    playwrightTmpDirs: countPlaywrightTmpDirs(),
  };
}
