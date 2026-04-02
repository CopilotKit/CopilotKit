import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  Input,
  ElementRef,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";

// The shape of a thread row — matches ɵThread from @copilotkit/core.
// Using a plain interface here so the component stays decoupled from the store
// until we wire up real data in CPK-7191.
export interface InspectorThread {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  summary: string | null;
  messageCount: number;
}

// --- Fake data -----------------------------------------------------------
// Swap this out for real store data once CPK-7191 (ThreadStoreRegistry) lands.
const FAKE_THREADS: InspectorThread[] = [
  {
    id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
    name: "Dog & Pony Show",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    userId: "user-1",
    summary: "The human and the robot debated dogs and ponies",
    messageCount: 49,
  },
  {
    id: "a1b2c3d4-0000-0000-0000-111111111111",
    name: "Tech Talk",
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    userId: "user-1",
    summary: "Exploring the future of AI and its impact on society",
    messageCount: 12,
  },
  {
    id: "b2c3d4e5-0000-0000-0000-222222222222",
    name: null,
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    userId: "user-2",
    summary: null,
    messageCount: 3,
  },
];
// -------------------------------------------------------------------------

@Component({
  selector: "cpk-thread-list",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div class="cpk-thread-list">
      <!-- Table header -->
      <div class="cpk-thread-list__header">
        <span>Created</span>
        <span>Updated</span>
        <span>User ID</span>
        <span>Thread Name</span>
        <span>Thread Summary</span>
        <span>Messages</span>
      </div>

      <!-- Rows -->
      <div
        *ngFor="let thread of threads"
        class="cpk-thread-list__row"
        (click)="onThreadClick(thread.id)"
      >
        <span>{{ thread.createdAt | date: "mediumDate" }}</span>
        <span>{{ thread.updatedAt | date: "mediumDate" }}</span>
        <span class="cpk-thread-list__truncate cpk-thread-list__user-id">{{
          thread.id
        }}</span>
        <span>{{ thread.name ?? "Untitled" }}</span>
        <span class="cpk-thread-list__truncate">{{
          thread.summary ?? "—"
        }}</span>
        <span>{{ thread.messageCount }}</span>
      </div>

      <!-- Empty state -->
      <div *ngIf="threads.length === 0" class="cpk-thread-list__empty">
        No threads yet.
      </div>
    </div>
  `,
  styles: [
    `
      @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&display=swap");

      .cpk-thread-list {
        font-family: "Plus Jakarta Sans", sans-serif;
        font-size: 12px;
        width: 100%;
        max-width: 1240px;
        /* Container: white glass — #FFFFFF at 64% opacity */
        background: rgba(255, 255, 255, 0.25);
        border: 1px solid #ffffff;
        border-radius: 16px;
        overflow: hidden;
      }

      /* Header: glass-surface
       Base: #E8EDF5 at 48% opacity.
       Three blurred colour blobs (Figma ellipses: imperial-blue #757CF2 left,
       aquamarine-green #5BE4BB centre, sin-orange #FFAC4D right, each blur:128).
       Radial sizes = ellipse radius + 128px blur spread. */
      .cpk-thread-list__header::after {
        content: "";
        position: absolute;
        inset: 0;
        background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        opacity: 0.12;
        mix-blend-mode: multiply;
        pointer-events: none;
      }

      .cpk-thread-list__header {
        position: relative;
        overflow: hidden;
        display: grid;
        grid-template-columns: 100px 100px 130px 1fr 1fr 60px;
        column-gap: 16px;
        padding: 0 16px;
        height: 46px;
        align-items: center;
        background:
          radial-gradient(
            ellipse 340px 340px at 14% 30%,
            rgba(117, 124, 242, 0.08) 0%,
            transparent 100%
          ),
          radial-gradient(
            ellipse 380px 380px at 52% 50%,
            rgba(91, 228, 187, 0.08) 0%,
            transparent 100%
          ),
          radial-gradient(
            ellipse 370px 370px at 97% 0%,
            rgba(255, 172, 77, 0.08) 0%,
            transparent 100%
          ),
          rgba(232, 237, 245, 0.48);
        font-family: "Plus Jakarta Sans", sans-serif;
        font-weight: 600;
        font-size: 11px;
        color: #000000;
      }

      .cpk-thread-list__row {
        display: grid;
        grid-template-columns: 100px 100px 130px 1fr 1fr 60px;
        column-gap: 16px;
        padding: 0 16px;
        height: 46px;
        align-items: center;
        border-bottom: 1px solid #00000014;
        cursor: pointer;
        color: #57575b;
      }
      .cpk-thread-list__row:last-child {
        border-bottom: none;
      }
      .cpk-thread-list__row:nth-child(even) {
        background: #ffffff;
      }
      .cpk-thread-list__row:nth-child(odd) {
        background: #fafafc;
      }
      .cpk-thread-list__row:hover {
        background: rgba(190, 194, 255, 0.08);
      }

      .cpk-thread-list__user-id {
        font-weight: 400;
        font-size: 13px;
        color: rgba(1, 5, 7, 0.48);
      }

      .cpk-thread-list__truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cpk-thread-list__empty {
        padding: 24px;
        text-align: center;
        color: #838389;
        font-size: 12px;
        background: #ffffff;
      }
    `,
  ],
})
export class ThreadListComponent {
  private el = inject(ElementRef);

  // Fake data for now — will be replaced with real store input
  @Input() threads: InspectorThread[] = FAKE_THREADS;

  onThreadClick(threadId: string): void {
    this.el.nativeElement.dispatchEvent(
      new CustomEvent("threadSelected", {
        detail: threadId,
        bubbles: true,
        composed: true,
      }),
    );
  }
}
