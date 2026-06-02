import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Middleware } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { map } from "rxjs";
import { createToolResultMessageIdNormalizer } from "./core/normalize-tool-result-message-ids";

export class NormalizeToolResultMessageIdsMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const normalizeEvent = createToolResultMessageIdNormalizer(input.messages);

    return this.runNext(input, next).pipe(
      map((event) => normalizeEvent(event)),
    );
  }
}
