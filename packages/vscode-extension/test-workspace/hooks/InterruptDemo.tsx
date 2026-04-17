import { useLangGraphInterrupt } from "@copilotkit/react-core";

export function InterruptDemo() {
  useLangGraphInterrupt({
    render: ({ event, resolve }) => (
      <div data-testid="interrupt-render">
        <pre>{JSON.stringify(event)}</pre>
        <button type="button" onClick={() => resolve("ok")}>
          Resolve
        </button>
      </div>
    ),
  });
  return null;
}

export default InterruptDemo;
