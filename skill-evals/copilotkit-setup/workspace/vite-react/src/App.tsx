import { useState } from "react";

interface Note {
  id: number;
  text: string;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");

  const addNote = () => {
    if (!draft.trim()) return;
    setNotes((prev) => [...prev, { id: Date.now(), text: draft.trim() }]);
    setDraft("");
  };

  return (
    <main
      style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}
    >
      <h1>Acme Notes</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNote()}
          placeholder="Write a note..."
          style={{ flex: 1 }}
        />
        <button onClick={addNote}>Add</button>
      </div>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>{note.text}</li>
        ))}
      </ul>
    </main>
  );
}
