import { Notification } from "../../../utils/notifications";

interface NotificationsPanelProps {
  notifications: Notification[];
}

export function NotificationsPanel({ notifications }: NotificationsPanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: "36px",
        right: "0",
        backgroundColor: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        width: "380px",
        maxHeight: "500px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          fontWeight: "600",
          fontSize: "14px",
          color: "#1f2937",
        }}
      >
        Notifications
      </div>
      <div
        style={{
          overflowY: "auto",
          maxHeight: "450px",
        }}
      >
        {notifications.length === 0 ? (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "#6b7280",
              fontSize: "14px",
            }}
          >
            No notifications
          </div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #f3f4f6",
                cursor: notif.url ? "pointer" : "default",
              }}
              onClick={() => {
                if (notif.url) {
                  window.open(notif.url, "_blank");
                }
              }}
              onMouseEnter={(e) => {
                if (notif.url) {
                  e.currentTarget.style.backgroundColor = "#f9fafb";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    fontSize: "16px",
                    lineHeight: "1",
                    marginTop: "2px",
                  }}
                >
                  {notif.severity === "error"
                    ? "🔴"
                    : notif.severity === "warning"
                      ? "⚠️"
                      : "ℹ️"}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#1f2937",
                      marginBottom: "4px",
                    }}
                  >
                    {notif.title}
                  </div>
                  {notif.description && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#6b7280",
                        lineHeight: "1.4",
                        marginBottom: "4px",
                      }}
                    >
                      {notif.description}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#9ca3af",
                    }}
                  >
                    {new Date(notif.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
