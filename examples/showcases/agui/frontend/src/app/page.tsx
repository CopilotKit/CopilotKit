import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { AGUI } from "./Components/AGUI";
export default function Home() {
  return (
    <>
      <CopilotKit showDevConsole runtimeUrl="api/copilotkit" agent="AG_UI">
        <AGUI />
      </CopilotKit>
    </>
  );
}
