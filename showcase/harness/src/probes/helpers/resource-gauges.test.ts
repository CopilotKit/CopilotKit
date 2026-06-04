import { describe, it, expect } from "vitest";
import {
  sampleResourceGauges,
  formatGauges,
  readCgroupPids,
} from "./resource-gauges";
import type { ResourceGauges } from "./resource-gauges";

describe("resource-gauges", () => {
  describe("sampleResourceGauges", () => {
    it("returns a fully-populated snapshot with all gauge fields", () => {
      const g = sampleResourceGauges();
      // Shape: every documented field is present and numeric (or ISO ts).
      expect(typeof g.ts).toBe("string");
      expect(Number.isNaN(Date.parse(g.ts))).toBe(false);
      const numericFields: Array<keyof ResourceGauges> = [
        "selfFdCount",
        "treeThreadCount",
        "treeProcCount",
        "zombieCount",
        "selfRssMb",
        "treeRssMb",
        "cgroupPidsCurrent",
        "cgroupPidsMax",
        "devShmUsedPct",
        "tmpInodeUsedPct",
        "tmpInodesUsed",
        "tmpInodesFree",
        "tmpSpaceUsedPct",
        "tmpSpaceFreeMb",
        "playwrightTmpDirs",
      ];
      for (const f of numericFields) {
        expect(typeof g[f]).toBe("number");
      }
    });

    it("degrades gracefully (no throw) regardless of host OS", () => {
      // The sampler reads Linux-specific /proc + /sys/fs/cgroup; on a non-Linux
      // host (e.g. CI/dev on macOS) every reader must fall back to -1 rather
      // than throwing. The headline cgroup gauges degrade to -1 off-Linux.
      expect(() => sampleResourceGauges()).not.toThrow();
    });
  });

  describe("readCgroupPids", () => {
    it("parses cgroup v2 pids.current / pids.max", () => {
      const fake = (p: string): string => {
        if (p === "/sys/fs/cgroup/pids.current") return "377\n";
        if (p === "/sys/fs/cgroup/pids.max") return "1000\n";
        throw new Error("ENOENT");
      };
      expect(readCgroupPids(fake)).toEqual({ current: 377, max: 1000 });
    });

    it("falls back to cgroup v1 paths when v2 is absent", () => {
      const fake = (p: string): string => {
        if (p === "/sys/fs/cgroup/pids/pids.current") return "500";
        if (p === "/sys/fs/cgroup/pids/pids.max") return "1000";
        throw new Error("ENOENT"); // v2 paths missing
      };
      expect(readCgroupPids(fake)).toEqual({ current: 500, max: 1000 });
    });

    it("reports unbounded pids.max ('max' sentinel) as -1", () => {
      const fake = (p: string): string => {
        if (p === "/sys/fs/cgroup/pids.current") return "120";
        if (p === "/sys/fs/cgroup/pids.max") return "max";
        throw new Error("ENOENT");
      };
      expect(readCgroupPids(fake)).toEqual({ current: 120, max: -1 });
    });

    it("returns -1/-1 when no cgroup PID controller is readable", () => {
      const fake = (): string => {
        throw new Error("ENOENT");
      };
      expect(readCgroupPids(fake)).toEqual({ current: -1, max: -1 });
    });
  });

  describe("formatGauges", () => {
    it("leads with the cgroup PID counters (the headline signal)", () => {
      const g: ResourceGauges = {
        ts: "2026-06-04T00:00:00.000Z",
        selfFdCount: 12,
        treeThreadCount: 850,
        treeProcCount: 33,
        zombieCount: 0,
        selfRssMb: 200,
        treeRssMb: 3600,
        cgroupPidsCurrent: 950,
        cgroupPidsMax: 1000,
        devShmUsedPct: 0,
        tmpInodeUsedPct: 1,
        tmpInodesUsed: 100,
        tmpInodesFree: 890,
        tmpSpaceUsedPct: 5,
        tmpSpaceFreeMb: 1000,
        playwrightTmpDirs: 6,
      };
      const line = formatGauges(g, "launch");
      expect(line).toContain("[launch]");
      expect(line).toContain("pidsCurrent=950");
      expect(line).toContain("pidsMax=1000");
      expect(line).toContain("threads=850");
      // The headline PID gauges precede the refuted-candidate differential.
      expect(line.indexOf("pidsCurrent")).toBeLessThan(
        line.indexOf("tmpInode"),
      );
    });

    it("omits the label bracket when no label is given", () => {
      const g = sampleResourceGauges();
      const line = formatGauges(g);
      expect(line.startsWith("[")).toBe(false);
      expect(line).toContain("pidsCurrent=");
    });
  });
});
