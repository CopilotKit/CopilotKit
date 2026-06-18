declare global {
  interface Window {
    electron: {
      runtime: { getUrl: () => Promise<string | null> };
    };
  }
}
