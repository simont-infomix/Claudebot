export type BotStatus = 'running' | 'stopped' | 'error';

export interface Bot {
  id: string;
  name: string;
  status: BotStatus;
  avatarDataUrl: string | null;
  allowedTools: string[];
  model: string | null;
  effort: string | null;
  permissionMode: string;
}

export interface BotSettingsDraft {
  name: string;
  allowedTools: string[];
  model: string | null;
  effort: string | null;
  permissionMode: string;
}

export type LogKind = 'assistant' | 'info' | 'error' | 'user' | 'thinking';

export interface LogLine {
  kind: LogKind;
  text: string;
}

export interface EncodedAttachment {
  name: string;
  dataBase64: string;
}

export type HostRequest =
  | { type: 'getBots' }
  | { type: 'createBot'; name: string }
  | { type: 'selectBot'; botId: string }
  | { type: 'openTerminal'; botId: string }
  | { type: 'openWorkspaceFolder'; botId: string }
  | { type: 'restartBot'; botId: string }
  | { type: 'setBotAvatar'; botId: string; contentType: string; dataBase64: string }
  | ({ type: 'saveSettings'; botId: string } & BotSettingsDraft)
  | { type: 'sendPrompt'; botId: string; text: string; attachments: EncodedAttachment[] };

export type HostEvent =
  | { type: 'botList'; bots: Bot[] }
  | { type: 'botLog'; botId: string; lines: LogLine[] }
  | { type: 'logAppended'; botId: string; line: LogLine }
  | { type: 'botStatusChanged'; botId: string; status: BotStatus }
  | { type: 'botRenamed'; oldId: string; newId: string }
  | { type: 'error'; message: string };
