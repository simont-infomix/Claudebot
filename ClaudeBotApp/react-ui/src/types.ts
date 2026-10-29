export type BotStatus = 'running' | 'stopped' | 'error';

export type SettingsTab = 'settings' | 'definition' | 'capabilities';

export type MainTab = 'chat' | 'tasks';

/**
 * Ütemezés-típusok (UC-010). Nincs külön "naponta" típus: a napi ismétlődés a `weekly`
 * mind a hét napjának kijelölésével adható meg ("minden nap" kapcsoló).
 */
export type TaskScheduleType = 'interval' | 'weekly' | 'monthly';

export interface TaskSchedule {
  type: TaskScheduleType;
  /** `interval` ("naponta többször") típusnál: két futás között eltelő percek száma. */
  intervalMinutes?: number;
  /** `weekly` és `monthly` típusnál: a futás időpontja "HH:MM" alakban. */
  timeOfDay?: string;
  /** `weekly` típusnál: a futás napjai, 0 = vasárnap … 6 = szombat. */
  daysOfWeek?: number[];
  /**
   * `monthly` típusnál: a hónap napjai 1–31 között. A 29–31. napok a rövidebb hónapokban a
   * hónap utolsó napjára csúsznak, hogy egyetlen hónap se maradjon ki.
   */
  daysOfMonth?: number[];
}

/** Egy lefutás kimenetele (UC-013, UC-015). */
export type TaskRunOutcome = 'success' | 'failed' | 'skipped';

export interface TaskRun {
  /** ISO-8601 időbélyeg. */
  at: string;
  outcome: TaskRunOutcome;
  /** `failed`/`skipped` esetén a rövid ok, amit a felhasználó lát. */
  error?: string | null;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: TaskSchedule;
  /** false = szüneteltetve: nem fut automatikusan, kézzel továbbra is indítható (UC-012). */
  enabled: boolean;
  /** null, ha a feladat még sosem futott le. */
  lastRun: TaskRun | null;
  /** ISO-8601; null, ha szüneteltetett (ilyenkor nincs esedékes futás). */
  nextRunAt: string | null;
}

export interface Bot {
  id: string;
  name: string;
  status: BotStatus;
  avatarDataUrl: string | null;
  allowedTools: string[];
  model: string | null;
  effort: string | null;
  permissionMode: string;
  scheduledTasks: ScheduledTask[];
  /** Van-e olyan bot-válasz vagy hiba, amit a felhasználó még nem látott (UC-017). Csak
   *  jelzés, nem számláló. */
  hasUnreadMessage: boolean;
}

/**
 * Amit a Settings lap szerkeszt. A feladatlista szándékosan NINCS benne: az a főképernyő
 * Feladatok tabján él, és azonnal ment — ha a Settings piszkozata is hordozná, egy elavult
 * másolattal felülírná a közben felvett feladatokat.
 */
export interface BotSettingsDraft {
  name: string;
  allowedTools: string[];
  model: string | null;
  effort: string | null;
  permissionMode: string;
}

export interface CapabilityInfo {
  name: string;
  description: string | null;
}

export interface BotDetails {
  agentDefinition: string | null;
  skills: CapabilityInfo[];
  subAgents: CapabilityInfo[];
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
  | { type: 'deleteBot'; botId: string }
  | { type: 'setBotAvatar'; botId: string; contentType: string; dataBase64: string }
  | ({ type: 'saveSettings'; botId: string; scheduledTasks: ScheduledTask[] } & BotSettingsDraft)
  | { type: 'setSettingsDirty'; dirty: boolean }
  | { type: 'respondToExitConfirm'; confirmed: boolean }
  | { type: 'getBotDetails'; botId: string }
  | { type: 'runTask'; botId: string; taskId: string }
  /** Melyik bot csevegése van ténylegesen a képernyőn — null, ha egyik sincs (UC-017). */
  | { type: 'setViewedBot'; botId: string | null }
  | { type: 'sendPrompt'; botId: string; text: string; attachments: EncodedAttachment[] };

export type HostEvent =
  | { type: 'botList'; bots: Bot[] }
  | { type: 'botLog'; botId: string; lines: LogLine[] }
  | { type: 'logAppended'; botId: string; line: LogLine }
  | { type: 'botStatusChanged'; botId: string; status: BotStatus }
  | { type: 'botRenamed'; oldId: string; newId: string }
  | { type: 'confirmExit' }
  | ({ type: 'botDetails'; botId: string } & BotDetails)
  | { type: 'error'; message: string };
