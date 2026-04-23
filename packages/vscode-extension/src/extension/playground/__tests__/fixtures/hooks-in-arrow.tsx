import { useCopilotAction } from "@copilotkit/react-core";

export const Page = () => {
  useCopilotAction({ name: "doThing", handler: () => {} });
  return <div />;
};

export default Page;
