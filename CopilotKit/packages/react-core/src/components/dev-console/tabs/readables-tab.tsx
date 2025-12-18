import { Readable, DisplayContext } from "../types";

export function ReadablesTab({ context }: { context: DisplayContext }) {
  const readables = context.getAllContext();

  if (readables.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No readable context available</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Readable context will appear here when provided
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {readables.map((readable: Readable, index: number) => (
        <div
          key={index}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <div style={{ flex: 1 }}>
              <h3 style={{ fontWeight: "600", color: "#1f2937", margin: "0 0 4px 0" }}>
                {readable.name || `Readable ${index + 1}`}
              </h3>
              {readable.description && (
                <p style={{ fontSize: "14px", color: "#4b5563", margin: "0 0 12px 0" }}>
                  {readable.description}
                </p>
              )}
              {readable.value && (
                <pre
                  style={{
                    marginTop: "12px",
                    padding: "8px",
                    backgroundColor: "#f9fafb",
                    borderRadius: "4px",
                    fontSize: "12px",
                    overflowX: "auto",
                    margin: "12px 0 0 0",
                  }}
                >
                  {JSON.stringify(readable.value, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
