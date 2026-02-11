import { Injectable } from "@angular/core";
import { filter, lastValueFrom, Subject, take } from "rxjs";

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
          (result) =>
            result.toolCallId === toolCallId && result.toolName === toolName
        ),
        take(1)
      )
    );
  }
}
