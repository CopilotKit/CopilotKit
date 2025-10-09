import { COPILOTKIT_VERSION } from "@copilotkit/shared";

interface ModalHeaderProps {
  isOutdated: boolean;
  unreadCount: number;
  showNotificationsPanel: boolean;
  showMenu: boolean;
  onToggleNotifications: () => void;
  onClose: () => void;
  onToggleMenu: () => void;
}

export function ModalHeader({
  isOutdated,
  unreadCount,
  showNotificationsPanel,
  showMenu,
  onToggleNotifications,
  onClose,
  onToggleMenu,
}: ModalHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 16px",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
        backgroundColor: "white",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              textTransform: "uppercase",
              fontWeight: "500",
            }}
          >
            Version
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontSize: "12px",
                color: "#4b5563",
                backgroundColor: "#f3f4f6",
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                fontFamily: "monospace",
              }}
            >
              v{COPILOTKIT_VERSION}
            </span>
            {isOutdated && (
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#fef3c7",
                  border: "1px solid #fbbf24",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="A newer version is available"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 4V8M8 10.5V11"
                    stroke="#d97706"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              textTransform: "uppercase",
              fontWeight: "500",
            }}
          >
            Runtime
          </span>
          <span
            style={{
              fontSize: "12px",
              color: "#4b5563",
              backgroundColor: "#f3f4f6",
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #e5e7eb",
              fontFamily: "monospace",
            }}
          >
            /api/foo
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative" }}>
        {/* Notifications bell */}
        <button
          onClick={onToggleNotifications}
          style={{
            background: "none",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            position: "relative",
          }}
          title={`Notifications${unreadCount > 0 ? ` (${unreadCount} new)` : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2C6.34315 2 5 3.34315 5 5V7.5C5 8.5 4.5 9 4 10H12C11.5 9 11 8.5 11 7.5V5C11 3.34315 9.65685 2 8 2Z"
              stroke="#6b7280"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6.5 10V10.5C6.5 11.3284 7.17157 12 8 12C8.82843 12 9.5 11.3284 9.5 10.5V10"
              stroke="#6b7280"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {unreadCount > 0 && (
            <div
              style={{
                position: "absolute",
                top: "-4px",
                right: "-4px",
                backgroundColor: "#3b82f6",
                color: "white",
                fontSize: "9px",
                fontWeight: "600",
                padding: "2px 4px",
                borderRadius: "8px",
                minWidth: "14px",
                height: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid white",
              }}
            >
              {unreadCount}
            </div>
          )}
        </button>

        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="#6b7280"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button
          onClick={onToggleMenu}
          style={{
            background: "none",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="3" r="1.5" fill="#6b7280" />
            <circle cx="8" cy="8" r="1.5" fill="#6b7280" />
            <circle cx="8" cy="13" r="1.5" fill="#6b7280" />
          </svg>
        </button>
      </div>
    </div>
  );
}
