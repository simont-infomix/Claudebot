export type BotStatus = 'running' | 'stopped' | 'error';

export interface Bot {
  id: string;
  name: string;
  status: BotStatus;
}

export type LogKind = 'assistant' | 'info' | 'error' | 'user';

export interface LogLine {
  kind: LogKind;
  text: string;
}

export type HostRequest =
  | { type: 'getBots' }
  | { type: 'createBot'; name: string }
  | { type: 'selectBot'; botId: string }
  | { type: 'openTerminal'; botId: string }
  | { type: 'sendPrompt'; botId: string; text: string };

export type HostEvent =
  | { type: 'botList'; bots: Bot[] }
  | { type: 'botLog'; botId: string; lines: LogLine[] }
  | { type: 'logAppended'; botId: string; line: LogLine }
  | { type: 'botStatusChanged'; botId: string; status: BotStatus }
  | { type: 'error'; message: string };
