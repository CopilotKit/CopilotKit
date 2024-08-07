import { map, filter, ReplaySubject } from "rxjs";
import { LangGraphEvent, LangGraphEventTypes } from "./events";
import { RuntimeEvent, RuntimeEventTypes } from "../../service-adapters/events";

export class LangGraphEventSource {
  private eventStream$ = new ReplaySubject<LangGraphEvent>();

  processLangGraphEvents() {
    return this.eventStream$.pipe(
      map((event): RuntimeEvent | null => {
        switch (event.event) {
          case LangGraphEventTypes.OnChainStart:
          case LangGraphEventTypes.OnChainEnd:
            return {
              type: RuntimeEventTypes.AgentMessage,
              threadId: "TODO: WHERE TO PUT THIS",
              agentName: "TODO: WHERE TO PUT THIS",
              nodeName: "TODO: WHERE TO PUT THIS",
              state: event.data.input,
              running: true,
            };
          default:
            return null;
        }
      }),
      filter((event): event is RuntimeEvent => event !== null),
    );
  }
}
