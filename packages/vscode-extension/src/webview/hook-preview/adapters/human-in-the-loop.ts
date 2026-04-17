import { actionAdapter } from "./action";
import type { Adapter } from "./types";

export const humanInTheLoopAdapter: Adapter<"human-in-the-loop"> =
  actionAdapter as unknown as Adapter<"human-in-the-loop">;
