import Link from "next/link";
import { Backdrop, Sidebar } from "./shell";
import { ArrowRight } from "./icons";

export default function NotFound() {
  return (
    <>
      <Backdrop />
      <div className="ck-app">
        <Sidebar current={null} />
        <main className="ck-card ck-plain">
          <h2>Page not found</h2>
          <p>
            This address isn&rsquo;t part of the demo. The chat and the catalog
            are the two pages here.
          </p>
          <Link href="/" className="ck-button ck-focus">
            Open the chat
            <ArrowRight />
          </Link>
        </main>
      </div>
    </>
  );
}
