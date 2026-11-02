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
  /** Kérdezzen-e a bot futásidőben engedélyt a nem engedélyezett eszközökre (UC-018). */
  interactiveApproval: boolean;
  /** Részt vesz-e a bot a közös bot-csatornán: kaphat-e üzenetet a többi bottól és küldhet-e
   *  nekik (UC-021). */
  channelEnabled: boolean;
  scheduledTasks: ScheduledTask[];
  /** Van-e olyan bot-válasz vagy hiba, amit a felhasználó még nem látott (UC-017). Csak
   *  jelzés, nem számláló. */
  hasUnreadMessage: boolean;
  /** Hány jóváhagyási kérése vár válaszra (UC-018) — a sidebar jelzéséhez. */
  pendingApprovalCount: number;
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
  interactiveApproval: boolean;
  channelEnabled: boolean;
}

export interface CapabilityInfo {
  name: string;
  description: string | null;
  /** A Bots/.claude/ közös mappából származik-e — ilyenkor minden bot eléri, nem csak ez. */
  shared: boolean;
}

export interface BotDetails {
  agentDefinition: string | null;
  skills: CapabilityInfo[];
  subAgents: CapabilityInfo[];
}

export type LogKind =
  | 'assistant'
  | 'info'
  | 'error'
  | 'user'
  | 'thinking'
  | 'permission'
  /** Bot-bot csatorna forgalma (UC-021): kimenő üzenet vagy egy másik bottól érkezett üzenet.
   *  Sem nem a felhasználó üzenete, sem nem a bot neki szóló válasza — megfigyelt forgalom. */
  | 'channel';

export interface LogLine {
  kind: LogKind;
  text: string;
  /** Csak 'permission' sornál: ez köti a chat adott pontját a jóváhagyási kéréshez, így a
   *  kártya a helyén marad bot-váltás és a beszélgetés visszatöltése után is (UC-018). */
  requestId?: string | null;
}

/** Egy jóváhagyási kérés sorsa. A 'pending'-en kívüli értékek véglegesek. */
export type PermissionDecision =
  | 'pending'
  | 'allowed'
  | 'allowedAlways'
  | 'denied'
  /** A felhasználó megválaszolta a bot kérdését (AskUserQuestion, UC-020). */
  | 'answered'
  /** A felhasználó explicit kihagyta a kérdést — nem a kör sikertelensége. */
  | 'skipped'
  | 'timedOut'
  /** A bot folyamata leállt/újraindult, mielőtt válasz született volna. */
  | 'cancelled';

/** A felhasználó három lehetséges válasza egy (nem kérdés-jellegű) kérésre. */
export type PermissionAnswer = 'allow' | 'allowAlways' | 'deny';

export interface UserQuestionOption {
  label: string;
  description: string | null;
}

/** Egy AskUserQuestion kérdés — a bot nem engedélyt kér, ténylegesen választ vár. */
export interface UserQuestion {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: UserQuestionOption[];
}

/** A bot egy olyan eszközt használna, amire nincs előzetes engedélye (UC-018), vagy — ha
 *  `requiresUserInteraction` igaz — ténylegesen választ vár a felhasználótól (UC-020). */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  /** Egysoros összefoglaló a kért műveletről (pl. a futtatandó parancs). */
  inputSummary: string;
  /** A teljes input JSON-ja, a lenyitható részletekhez. */
  inputJson: string;
  decisionReason: string | null;
  /** Ütemezett feladat köre-e — ilyenkor rövidebb a válaszadási határidő. */
  isScheduledRun: boolean;
  /** ISO-8601; eddig vár a kérés, utána automatikus elutasítás. */
  expiresAt: string;
  requiresUserInteraction: boolean;
  /** Csak akkor van kitöltve, ha `requiresUserInteraction` igaz és a tool AskUserQuestion. */
  questions?: UserQuestion[];
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
  | { type: 'respondToPermission'; botId: string; requestId: string; decision: PermissionAnswer }
  /** answers kulcsa a kérdés szövege, értéke a választott opció(k) label-je — ld. UC-020. */
  | { type: 'answerUserQuestion'; botId: string; requestId: string; answers: Record<string, string | string[]> }
  | { type: 'skipUserQuestion'; botId: string; requestId: string }
  | { type: 'sendPrompt'; botId: string; text: string; attachments: EncodedAttachment[] };

export type HostEvent =
  | { type: 'botList'; bots: Bot[] }
  /** A beszélgetés és a hozzá tartozó függő kérések EGY üzenetben — két külön eseménynél a
   *  sorrendjük nem lenne garantált, és a kártyák rövid időre rossz állapotban jelennének meg. */
  | { type: 'botLog'; botId: string; lines: LogLine[]; pendingPermissions: PermissionRequest[] }
  | { type: 'logAppended'; botId: string; line: LogLine }
  | { type: 'permissionRequest'; botId: string; request: PermissionRequest }
  | { type: 'permissionResolved'; botId: string; requestId: string; decision: PermissionDecision }
  | { type: 'botStatusChanged'; botId: string; status: BotStatus }
  | { type: 'botRenamed'; oldId: string; newId: string }
  | { type: 'confirmExit' }
  | ({ type: 'botDetails'; botId: string } & BotDetails)
  | { type: 'error'; message: string };
