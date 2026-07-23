// Slow, rate-capped stdout reader — models Railway's downstream log drain cap
// (~500 logs/sec, "Messages dropped: 122" in the incident). By reading only
// CAP lines per TICK and pausing in between, it lets the upstream pipe buffer
// fill, which is what triggers the blocking write(2) in the producer.
//
// Sits at the end of the pipeline:  server.mjs | awk '{...;fflush()}' | reader.mjs
// mirroring the real  next start &> >(awk '{...; fflush()}')  where awk's
// stdout is the container's Railway-consumed stdout.

import readline from "node:readline";

const CAP = parseInt(process.env.CAP || "50", 10); // lines drained per tick
const TICK = parseInt(process.env.TICK || "1000", 10); // ms per tick

let budget = CAP;
const rl = readline.createInterface({ input: process.stdin });

setInterval(() => {
  budget = CAP;
  process.stdin.resume();
}, TICK);

rl.on("line", () => {
  if (--budget <= 0) {
    // Stop draining until the next tick — this is the throttle that fills the
    // upstream pipe.
    process.stdin.pause();
  }
});
