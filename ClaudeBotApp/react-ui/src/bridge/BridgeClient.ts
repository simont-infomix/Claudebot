import type { BotSettingsDraft, EncodedAttachment, HostEvent, ScheduledTask } from '../types';

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

  deleteBot(botId: string): void {
    this.send({ type: 'deleteBot', botId });
  }

  setBotAvatar(botId: string, contentType: string, dataBase64: string): void {
    this.send({ type: 'setBotAvatar', botId, contentType, dataBase64 });
  }

  /** A beállítások és a feladatlista külön érkezik, mert két különböző felület szerkeszti őket —
   *  a hívónak mindig a másik fél FRISS állapotát kell megadnia, nem egy piszkozatból vett
   *  másolatot. */
  saveSettings(botId: string, settings: BotSettingsDraft, scheduledTasks: ScheduledTask[]): void {
    this.send({ type: 'saveSettings', botId, ...settings, scheduledTasks });
  }

  setSettingsDirty(dirty: boolean): void {
    this.send({ type: 'setSettingsDirty', dirty });
  }

  respondToExitConfirm(confirmed: boolean): void {
    this.send({ type: 'respondToExitConfirm', confirmed });
  }

  getBotDetails(botId: string): void {
    this.send({ type: 'getBotDetails', botId });
  }

  runTask(botId: string, taskId: string): void {
    this.send({ type: 'runTask', botId, taskId });
  }

  sendPrompt(botId: string, text: string, attachments: EncodedAttachment[] = []): void {
    this.send({ type: 'sendPrompt', botId, text, attachments });
  }
}

export const bridge = new BridgeClient();
