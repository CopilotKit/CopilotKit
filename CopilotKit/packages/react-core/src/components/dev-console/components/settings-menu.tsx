interface SettingsMenuProps {
  onHideForDay: () => void;
  onClose: () => void;
}

export function SettingsMenu({ onHideForDay, onClose }: SettingsMenuProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: "36px",
        right: "0",
        backgroundColor: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        minWidth: "180px",
        zIndex: 100,
      }}
    >
      <button
        onClick={() => {
          onHideForDay();
          onClose();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "10px 14px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontSize: "14px",
          color: "#374151",
          textAlign: "left",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        🚫 Disable inspector
      </button>
    </div>
  );
}
