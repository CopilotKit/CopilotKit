import { UserButton, useUser } from "@clerk/tanstack-react-start";
import type { useThreads } from "@copilotkit/react-core/v2";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import {
  Archive,
  ExternalLink,
  LayoutGrid,
  LogIn,
  NotebookPen,
  PanelLeftClose,
  Plug,
  SquarePen,
  X,
} from "lucide-react";
import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useDesk } from "../lib/desk-store";
import { ThreadIcon } from "../lib/thread-icons";
import type { StagePage } from "../lib/use-stage-page";
import { BrandMark } from "./BrandMark";

type Thread = ReturnType<typeof useThreads>["threads"][number];

const DAY = 24 * 60 * 60 * 1000;

function groupThreads(threads: readonly Thread[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups: { label: string; threads: Thread[] }[] = [
    { label: "Today", threads: [] },
    { label: "This week", threads: [] },
    { label: "Earlier", threads: [] },
  ];
  for (const thread of threads) {
    const at = Date.parse(thread.lastRunAt ?? thread.updatedAt);
    const group = at >= startOfToday ? 0 : at >= startOfToday - 6 * DAY ? 1 : 2;
    groups[group].threads.push(thread);
  }
  return groups.filter((group) => group.threads.length);
}

export function ThreadDrawer({
  threads: threadsState,
  icons,
  onCollapse,
  onNavigate,
  newQuestionRef,
  page,
  onOpenPage,
  signedIn,
}: {
  threads: ReturnType<typeof useThreads>;
  /** Icon names by thread id; null once a thread is known to have none. */
  icons: Record<string, string | null>;
  onCollapse: () => void;
  /** Called after the reader opens a thread or starts a new one. */
  onNavigate?: () => void;
  /** The New question button, where focus lands when the drawer opens. */
  newQuestionRef: RefObject<HTMLButtonElement | null>;
  /** What the stage shows: the chat, or a page in its place. */
  page: StagePage;
  onOpenPage: (page: StagePage) => void;
  /** Signed out, nothing is kept: no thread list, and Sign in at the foot. */
  signedIn: boolean;
}) {
  const config = useCopilotChatConfiguration();
  const {
    threads,
    isLoading,
    error,
    archiveThread,
    unarchiveThread,
    hasMoreThreads,
    fetchMoreThreads,
    isFetchingMoreThreads,
  } = threadsState;
  const { announce } = useDesk();
  const groups = useMemo(() => groupThreads(threads), [threads]);
  const activeId = config?.threadId;
  // Each row's open button, so archiving can move focus to a neighbour.
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  const archive = async (thread: Thread, active: boolean) => {
    const name = thread.name ?? "Untitled question";
    // Keep keyboard focus in the list: the neighbouring row, else New question.
    const index = threads.findIndex((t) => t.id === thread.id);
    const neighbour = threads[index + 1] ?? threads[index - 1];
    const focusAfter = () =>
      requestAnimationFrame(() =>
        (
          (neighbour && rowButtons.current.get(neighbour.id)) ??
          newQuestionRef.current
        )?.focus(),
      );
    if (active) config?.startNewThread();
    try {
      await archiveThread(thread.id);
      focusAfter();
      announce(`Archived “${name}”`, {
        label: "Undo",
        run: () => {
          unarchiveThread(thread.id)
            .then(() => {
              if (active)
                config?.setActiveThreadId(thread.id, { explicit: true });
            })
            .catch(() => announce("That thread could not be restored"));
        },
      });
    } catch {
      announce(`“${name}” could not be archived`);
    }
  };

  return (
    <div className="drawer">
      <header className="drawer__head">
        <a
          className="drawer__home"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            config?.startNewThread();
            onNavigate?.();
          }}
        >
          <BrandMark />
          A2UI Playground
        </a>
        <button
          type="button"
          className="icon-button"
          onClick={onCollapse}
          aria-label="Hide threads"
          title="Hide threads"
        >
          <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      <button
        ref={newQuestionRef}
        type="button"
        className="drawer__new"
        onClick={() => {
          config?.startNewThread();
          onNavigate?.();
        }}
      >
        <SquarePen size={16} strokeWidth={1.75} aria-hidden />
        New question
      </button>

      <nav className="drawer__scroll" aria-label="Threads">
        {signedIn && error && !threads.length && (
          <p className="drawer__empty">
            Threads could not load. Check the Intelligence key.
          </p>
        )}
        {signedIn && isLoading && !threads.length && (
          <ul className="drawer__list" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="thread thread--placeholder" />
            ))}
          </ul>
        )}
        {signedIn && !isLoading && !error && !threads.length && (
          <p className="drawer__empty">
            Your questions will collect here, each with an icon the agent picks.
          </p>
        )}

        {groups.map((group) => (
          <div
            key={group.label}
            className="drawer__group"
            role="group"
            aria-labelledby={`threads-${group.label}`}
          >
            <h2 className="drawer__label" id={`threads-${group.label}`}>
              {group.label}
            </h2>
            <ul className="drawer__list">
              {group.threads.map((thread) => {
                const active = thread.id === activeId;
                return (
                  <li
                    key={thread.id}
                    className="thread"
                    data-active={(active && page === "chat") || undefined}
                  >
                    <button
                      ref={(element) => {
                        if (element) rowButtons.current.set(thread.id, element);
                        else rowButtons.current.delete(thread.id);
                      }}
                      type="button"
                      className="thread__open"
                      aria-current={
                        active && page === "chat" ? "page" : undefined
                      }
                      onClick={() => {
                        config?.setActiveThreadId(thread.id, {
                          explicit: true,
                        });
                        onNavigate?.();
                      }}
                    >
                      <ThreadIcon name={icons[thread.id]} />
                      <span className="thread__name">
                        {thread.name ?? "Untitled question"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="thread__archive icon-button"
                      aria-label={`Archive ${thread.name ?? "thread"}`}
                      title="Archive"
                      onClick={() => void archive(thread, active)}
                    >
                      <Archive size={14} strokeWidth={1.75} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {hasMoreThreads && (
          <button
            type="button"
            className="drawer__more"
            onClick={fetchMoreThreads}
            disabled={isFetchingMoreThreads}
          >
            {isFetchingMoreThreads ? "Loading…" : "Show older"}
          </button>
        )}
      </nav>

      <footer className="drawer__foot">
        <button
          type="button"
          className="drawer__tab"
          aria-current={page === "connections" ? "page" : undefined}
          onClick={() => onOpenPage("connections")}
        >
          <Plug size={16} strokeWidth={1.75} aria-hidden />
          Connections
        </button>
        <button
          type="button"
          className="drawer__tab"
          aria-current={page === "catalog" ? "page" : undefined}
          onClick={() => onOpenPage("catalog")}
        >
          <LayoutGrid size={16} strokeWidth={1.75} aria-hidden />
          Catalog
        </button>
        <NotesTab />
        {signedIn ? (
          <Account />
        ) : (
          <a
            className="drawer__tab"
            href="/sign-in"
            title="Sign in to keep your threads and connect your apps"
          >
            <LogIn size={16} strokeWidth={1.75} aria-hidden />
            Sign in
          </a>
        )}
        <p className="drawer__byline">
          Powered by{" "}
          <a href="https://www.copilotkit.ai" target="_blank" rel="noreferrer">
            CopilotKit
          </a>
        </p>
      </footer>
    </div>
  );
}

/** The signed-in reader, with Clerk's menu (account, sign out) on their avatar. */
function Account() {
  const { user } = useUser();
  return (
    <div className="drawer__account">
      <UserButton />
      <span className="drawer__account-name">
        {user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? ""}
      </span>
    </div>
  );
}

/**
 * The notes the reader saved from answers: a tab at the foot of the drawer
 * that opens them in a dialog.
 */
function NotesTab() {
  const { notes, removeNote } = useDesk();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        type="button"
        className="drawer__tab"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <NotebookPen size={16} strokeWidth={1.75} aria-hidden />
        Notes
        <span className="notes__count">{notes.length}</span>
      </button>
      <dialog
        ref={dialog}
        className="notes-dialog"
        aria-labelledby="notes-dialog-title"
        // A click on the backdrop lands on the dialog itself; the content
        // sits in its own element.
        onClick={(event) => event.target === event.currentTarget && close()}
      >
        <div className="notes-dialog__body">
          <header className="notes-dialog__head">
            <h2 id="notes-dialog-title">Notes</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close notes"
              onClick={close}
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          <ul className="notes__list">
            {!notes.length && (
              <li className="notes__empty">
                Findings you save from an answer appear here.
              </li>
            )}
            {notes.map((note) => (
              <li key={note.id} className="note">
                <p className="note__title">{note.title}</p>
                <p className="note__text">{note.text}</p>
                <div className="note__actions">
                  {note.sourceUrl && (
                    <a
                      href={note.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="note__link"
                    >
                      Source <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${note.title}`}
                    onClick={() => removeNote(note.id)}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
