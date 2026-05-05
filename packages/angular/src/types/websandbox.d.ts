declare module "@jetbrains/websandbox" {
  interface SandboxInstance {
    run: (code: string | Function) => Promise<unknown>;
    destroy: () => void;
    iframe: HTMLIFrameElement;
    promise: Promise<unknown>;
  }

  interface WebsandboxClass {
    create: (
      localApi: Record<string, Function>,
      options: {
        frameContainer: HTMLElement;
        frameContent: string;
        allowAdditionalAttributes?: string;
      },
    ) => SandboxInstance;
  }

  const Websandbox: WebsandboxClass | { default: WebsandboxClass };
  export default Websandbox;
}
