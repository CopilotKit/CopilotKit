import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

export interface BeautifulTodo {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly emoji: string;
  readonly status: "pending" | "completed";
}

@Component({
  selector: "showcase-beautiful-todo-canvas",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="todo-canvas" aria-labelledby="todo-title">
      <header>
        <div>
          <span>Shared agent state</span>
          <h2 id="todo-title">Task manager</h2>
        </div>
        <button type="button" [disabled]="isRunning()" (click)="addTodo()">
          Add a task
        </button>
      </header>
      @if (todos().length === 0) {
        <div class="empty">
          <span aria-hidden="true">✏️</span>
          <strong>No todos yet</strong>
          <p>Create your first task to get started.</p>
        </div>
      } @else {
        <div class="columns">
          @for (column of columns; track column.status) {
            <section [attr.aria-label]="column.label">
              <h3>{{ column.label }}</h3>
              <div class="todo-list">
                @for (todo of todosFor(column.status); track todo.id) {
                  <article [attr.data-testid]="'todo-' + todo.id">
                    <span class="emoji" aria-hidden="true">{{ todo.emoji }}</span>
                    <div>
                      <strong>{{ todo.title }}</strong>
                      <p>{{ todo.description }}</p>
                    </div>
                    <div class="todo-actions">
                      <button
                        type="button"
                        [attr.data-testid]="'todo-toggle-' + todo.id"
                        [attr.aria-label]="
                          todo.status === 'completed'
                            ? 'Move ' + todo.title + ' to pending'
                            : 'Complete ' + todo.title
                        "
                        [disabled]="isRunning()"
                        (click)="toggle(todo)"
                      >
                        {{ todo.status === "completed" ? "↩" : "✓" }}
                      </button>
                      <button
                        type="button"
                        [attr.aria-label]="'Delete ' + todo.title"
                        [disabled]="isRunning()"
                        (click)="remove(todo.id)"
                      >
                        ×
                      </button>
                    </div>
                  </article>
                } @empty {
                  <p class="column-empty">{{ column.empty }}</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .todo-canvas {
      min-height: 100%;
      padding: clamp(1rem, 3vw, 2.5rem);
      color: #14213d;
      background: #f7f9fc;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    header span {
      color: #66758a;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h2,
    h3,
    p {
      margin: 0;
    }
    h2 {
      margin-top: 0.2rem;
      font-size: 1.7rem;
    }
    button {
      border: 1px solid #cbd5e1;
      border-radius: 0.65rem;
      color: #20324d;
      background: #fff;
      cursor: pointer;
    }
    header button {
      padding: 0.6rem 0.85rem;
      font-weight: 650;
    }
    button:focus-visible {
      outline: 3px solid #91a7ff;
      outline-offset: 2px;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
    }
    .columns section {
      min-width: 0;
    }
    h3 {
      margin-bottom: 0.65rem;
      font-size: 0.9rem;
    }
    .todo-list {
      display: grid;
      gap: 0.65rem;
    }
    article {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 0.7rem;
      padding: 0.9rem;
      border: 1px solid #d8e0ea;
      border-radius: 0.85rem;
      background: #fff;
    }
    article p {
      margin-top: 0.2rem;
      color: #66758a;
      font-size: 0.78rem;
    }
    .emoji {
      font-size: 1.35rem;
    }
    .todo-actions {
      display: flex;
      gap: 0.3rem;
    }
    .todo-actions button {
      width: 2rem;
      height: 2rem;
    }
    .empty {
      display: grid;
      min-height: 18rem;
      place-items: center;
      align-content: center;
      gap: 0.45rem;
      text-align: center;
    }
    .empty span {
      font-size: 3rem;
    }
    .empty p,
    .column-empty {
      color: #66758a;
      font-size: 0.85rem;
    }
    @media (max-width: 44rem) {
      .columns {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class BeautifulTodoCanvas {
  readonly todos = input.required<readonly BeautifulTodo[]>();
  readonly isRunning = input(false);
  readonly todosChange = output<BeautifulTodo[]>();
  protected readonly columns = [
    { status: "pending", label: "To Do", empty: "No pending todos" },
    { status: "completed", label: "Done", empty: "No completed todos yet" },
  ] as const;

  /** Select the tasks rendered in one status column. */
  protected todosFor(status: BeautifulTodo["status"]): BeautifulTodo[] {
    return this.todos().filter((todo) => todo.status === status);
  }

  /** Toggle one task through an immutable state update. */
  protected toggle(todo: BeautifulTodo): void {
    this.todosChange.emit(
      this.todos().map((candidate) =>
        candidate.id === todo.id
          ? {
              ...candidate,
              status:
                candidate.status === "completed" ? "pending" : "completed",
            }
          : candidate,
      ),
    );
  }

  /** Remove one task through an immutable state update. */
  protected remove(id: string): void {
    this.todosChange.emit(this.todos().filter((todo) => todo.id !== id));
  }

  /** Append a locally created task through the shared-state output. */
  protected addTodo(): void {
    this.todosChange.emit([
      ...this.todos(),
      {
        id: createTodoId(),
        title: "New Todo",
        description: "Add a description",
        emoji: "🎯",
        status: "pending",
      },
    ]);
  }
}

/** Create a collision-resistant local task identifier. */
function createTodoId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

/** Parse backend state defensively into task cards. */
export function readBeautifulTodos(state: unknown): BeautifulTodo[] {
  if (state === null || typeof state !== "object") return [];
  const todos = (state as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== "object") return [];
    const todo = candidate as Record<string, unknown>;
    if (
      typeof todo["id"] !== "string" ||
      typeof todo["title"] !== "string" ||
      typeof todo["description"] !== "string" ||
      typeof todo["emoji"] !== "string" ||
      (todo["status"] !== "pending" && todo["status"] !== "completed")
    ) {
      return [];
    }
    return [
      {
        id: todo["id"],
        title: todo["title"],
        description: todo["description"],
        emoji: todo["emoji"],
        status: todo["status"],
      },
    ];
  });
}
