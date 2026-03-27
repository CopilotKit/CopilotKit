const browserOnlyError = (name: string) =>
  new Error(
    `${name} is not available in browser bundles. Import it from a server-side runtime entry instead.`,
  );

export class LangChainAdapter {
  constructor() {
    throw browserOnlyError("LangChainAdapter");
  }
}

export class GoogleGenerativeAIAdapter extends LangChainAdapter {}

export class BedrockAdapter extends LangChainAdapter {}

export class ExperimentalOllamaAdapter {
  constructor() {
    throw browserOnlyError("ExperimentalOllamaAdapter");
  }
}

export class RemoteChain {
  constructor() {
    throw browserOnlyError("RemoteChain");
  }
}
