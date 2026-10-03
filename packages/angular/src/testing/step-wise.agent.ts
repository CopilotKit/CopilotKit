import { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, ReplaySubject } from "rxjs";

export class StepwiseAgent extends AbstractAgent {
  /**
   * RxJS 7 does not set `closed` on `complete()`, so completion is tracked here.
   */
  private events = new ReplaySubject<BaseEvent>();
  private subscribed = false;
  private completed = false;

  emit(event: BaseEvent): void {
    if (this.subscribed && this.completed) {
      this.startRun();
    }
    this.events.next(event);
  }

  complete(): void {
    this.events.complete();
    this.completed = true;
  }

  override run(_input: RunAgentInput): Observable<BaseEvent> {
    if (this.subscribed) this.startRun();
    this.subscribed = true;
    return this.events.asObservable();
  }

  private startRun(): void {
    this.events = new ReplaySubject<BaseEvent>();
    this.subscribed = false;
    this.completed = false;
  }
}
