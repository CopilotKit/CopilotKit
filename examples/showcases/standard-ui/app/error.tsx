"use client";

import { useEffect } from "react";
import { Backdrop, Sidebar } from "./shell";

/** Any render error on a page: say so plainly and offer a retry. */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Backdrop />
      <div className="ck-app">
        <Sidebar current={null} />
        <main className="ck-card ck-plain">
          <h2>Something broke</h2>
          <p>
            The page failed while rendering. Try again; if it keeps happening,
            reload to start a new chat.
          </p>
          <button type="button" className="ck-button ck-focus" onClick={reset}>
            Try again
          </button>
        </main>
      </div>
    </>
  );
}
