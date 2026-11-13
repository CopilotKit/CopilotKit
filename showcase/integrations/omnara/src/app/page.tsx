import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Omnara</h1>
      <ul>
        <li>
          <Link href="/demos/agentic-chat">Agentic chat</Link>
        </li>
        <li>
          <Link href="/demos/frontend-tools">Frontend tools</Link>
        </li>
        <li>
          <Link href="/demos/tool-rendering-default-catchall">
            Tool rendering
          </Link>
        </li>
      </ul>
    </main>
  );
}
