import type { EncodedAttachment, HostEvent } from '../types';

type Listener = (event: HostEvent) => void;

class BridgeClient {
  private listeners = new Set<Listener>();

  constructor() {
    window.chrome?.webview?.addEventListener('message', (e) => {
      const data = e.data as HostEvent;
      this.listeners.forEach((listener) => listener(data));
    });
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(message: unknown): void {
    window.chrome?.webview?.postMessage(message);
  }

  getBots(): void {
    this.send({ type: 'getBots' });
  }

  createBot(name: string): void {
    this.send({ type: 'createBot', name });
  }

  selectBot(botId: string): void {
    this.send({ type: 'selectBot', botId });
  }

  openTerminal(botId: string): void {
    this.send({ type: 'openTerminal', botId });
  }

  openWorkspaceFolder(botId: string): void {
    this.send({ type: 'openWorkspaceFolder', botId });
  }

  restartBot(botId: string): void {
    this.send({ type: 'restartBot', botId });
  }

  setBotDisplayName(botId: string, name: string): void {
    this.send({ type: 'setBotDisplayName', botId, name });
  }

  setBotAvatar(botId: string, contentType: string, dataBase64: string): void {
    this.send({ type: 'setBotAvatar', botId, contentType, dataBase64 });
  }

  sendPrompt(botId: string, text: string, attachments: EncodedAttachment[] = []): void {
    this.send({ type: 'sendPrompt', botId, text, attachments });
  }
}

export const bridge = new BridgeClient();
