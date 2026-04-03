import {
  CopilotKitProvider,
  CopilotChat,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

function WeatherTool() {
  useRenderTool({
    name: "get_weather",
    render: ({ status, parameters, result }: any) => {
      const city = parameters?.city ?? "...";
      return (
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 16,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            fontFamily: "system-ui",
            minWidth: 220,
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>
            Weather
          </div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{city}</div>
          {status === "complete" && result ? (
            <div style={{ marginTop: 8, fontSize: 32, fontWeight: 700 }}>
              {result}
            </div>
          ) : (
            <div style={{ marginTop: 8, opacity: 0.7 }}>
              {status === "executing" ? "Fetching..." : "Loading..."}
            </div>
          )}
        </div>
      );
    },
  });
  return null;
}

export default function Index() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <WeatherTool />
      <div className="h-screen w-screen">
        <CopilotChat className="h-full w-full" />
      </div>
    </CopilotKitProvider>
  );
}
