import { Injectable } from "@angular/core";
import { filter, lastValueFrom, map, Subject, take } from "rxjs";

@Injectable({ providedIn: "root" })
export class HumanInTheLoop {
  results = new Subject<{
    toolCallId: string;
    toolName: string;
    result: unknown;
  }>();

  addResult(toolCallId: string, toolName: string, result: unknown) {
    this.results.next({ toolCallId, toolName, result });
  }

  onResult(toolCallId: string, toolName: string): Promise<unknown> {
    return lastValueFrom(
      this.results.pipe(
        filter(
          (entry) =>
            entry.toolCallId === toolCallId && entry.toolName === toolName,
        ),
        take(1),
        // Resolve with the bare result. toolCallId/toolName are routing keys for
        // this bus only — leaking them would make the tool result an envelope
        // that no consumer expects.
        map((entry) => entry.result),
      ),
    );
  }
}
