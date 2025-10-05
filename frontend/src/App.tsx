import { useState } from "react";

function App() {
  const [email, setEmail] = useState("");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSummarize = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:8000/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_text: email }),
      });

      if (!response.ok) throw new Error("Server error");

      const data = await response.json();
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
      setSummary("Error summarizing email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "auto" }}>
      <h1>Email Summarizer</h1>
      <textarea
        rows={10}
        style={{ width: "100%", marginBottom: "1rem" }}
        placeholder="Paste your email here..."
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button onClick={handleSummarize} disabled={loading}>
        {loading ? "Summarizing..." : "Summarize"}
      </button>
      {summary && (
        <div style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>
          <h2>Summary:</h2>
          {summary}
        </div>
      )}
    </div>
  );
}

export default App;
