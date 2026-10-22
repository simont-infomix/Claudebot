export {};

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: unknown): void;
        addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
        removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
      };
    };
  }
}
