# Local resource budget

The user reported memory pressure during the repair run. Multiple documentation test invocations had overlapping/orphaned fork workers. Root stopped identified remaining workers using approximately 13.6 GiB resident memory at termination; lane cleanup also stopped all audit docs previews, integration UIs/agents, and the audit AIMock container. Existing user cpki services were left running. Physical free memory recovered to approximately 32 GiB.

## Updated user limit

The user explicitly permits up to **30 GB total audit memory**. This is an aggregate ceiling, not a per-agent allowance or a target. Aim for 20–24 GB or less, including room for mock/browser overhead, and stop earlier if system pressure returns.

## Required execution rules for this repair

- Root coordinates validation slots. At most one bounded docs suite and one framework stack may run concurrently; no agent starts extra heavy work without a slot.
- Run the full docs suite with at most two forks and a 4 GiB heap cap per Node process. Parent plus two workers have a bounded theoretical heap budget near 12 GiB. Keep a one-worker, fresh-process batched fallback. Never overlap full-suite instances.
- Keep only one integration frontend/backend stack plus its mock dependency active at a time.
- Run baseline and repaired previews sequentially; preserve screenshots and response records instead of keeping both servers alive.
- Check memory before, during, and after heavy work. Stop the audit workload if pressure returns.
- Verify the parent process and workers terminate before the next validation. A completed parent alone is not cleanup.
- Preserve interrupted logs, but never count interrupted validation as passing.
- Source inspection and lightweight editing may continue while no heavy slot is granted. Freeze relevant inputs during a qualifying run.

## Initial constrained command (heap-limited; not the current gate)

```sh
NODE_OPTIONS=--max-old-space-size=2048 npm --prefix showcase/shell-docs test -- --pool=forks --maxWorkers=1 --no-file-parallelism
```

The previous full suite was terminated during cleanup. Typecheck/build results obtained before the incident remain recorded separately; the final full-suite result awaits the constrained rerun.

## Constrained rerun outcome

The one-worker run completed pretest generation, then exited 134 at the 2 GiB Node heap limit shortly after Vitest startup. Log: `/private/tmp/docs-audit-single-worker-suite.log`. No test verdict is claimed. Root verified no workers remained; system memory remained healthy (memory_pressure reported 84% free). The next docs gate will use smaller/sharded groups before considering any bounded cap adjustment. Runtime verification may use the single slot with one stack and an approximately 4 GiB combined audit-process budget.

## Current bounded gate

`run-shell-docs-bounded-suite.sh` uses the documented pretest plus at most two Vitest fork workers and 4 GiB per Node heap. It owns a dedicated process group and cleans only that group after completion or failure. Static safety review precedes execution. The sharded runner remains a fallback. Monitor aggregate memory while the runtime stack is also active.

The bounded run completed in 123 seconds: 911/922 tests and 117/122 files passed. Exit 1 is a completed failing gate, not qualification. The observed docs pool peaked near 16.2 GiB RSS while the single runtime stack used approximately 3.5 GiB. All test workers exited after cleanup. Log: `/private/tmp/shell-docs-bounded-suite-20260910-203507.log`.

The subsequent focused run passed all six tests across four files after pretypecheck, covering repaired C032–C034 regions and restored LFS image assets. It also left no documentation test or generator workers behind. Full-suite qualification remains pending the remaining repairs.
