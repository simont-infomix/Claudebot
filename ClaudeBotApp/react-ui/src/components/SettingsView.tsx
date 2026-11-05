import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Bot, BotDetails, BotSettingsDraft, CapabilityInfo, SettingsTab } from '../types';
import { Select } from './Select';
import { ConfirmDialog } from './ConfirmDialog';
import './SettingsView.css';

interface Props {
  bot: Bot | null;
  open: boolean;
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  details: BotDetails | null;
  error: string | null;
  onClose: () => void;
  onSetAvatar: (contentType: string, dataBase64: string) => void;
  onSave: (settings: BotSettingsDraft) => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'settings', label: 'Beállítások' },
  { id: 'definition', label: 'Bot definíció' },
  { id: 'capabilities', label: 'Képességek' },
];

// Gyors hozzáadás gombok: a leggyakrabban használt MCP-szerverek wildcard-mintái. Nem egy élő
// szerverlistából generálódnak — ha új MCP-szerver kerül bekötésre, ide is fel kell venni.
// (A claude.exe system/init eseménye csak az éppen ENGEDÉLYEZETT tool-okat sorolja fel, egy
// letiltott MCP-szerveré nem szerepel benne — ebből tehát nem lehet megbízhatóan dinamikusan
// felépíteni a listát, mert egy kikapcsolt szervert soha nem lehetne újra bekapcsolni.)
const SUGGESTED_TOOL_PATTERNS = [
  { label: 'Összes MCP tool', pattern: 'mcp__*' },
  { label: 'Azure DevOps', pattern: 'mcp__azure-devops__*' },
  { label: 'Todo MCP', pattern: 'mcp__todo-mcp__*' },
  { label: 'Microsoft 365', pattern: 'mcp__claude_ai_Microsoft_365__*' },
  { label: 'Claude Docs', pattern: 'mcp__claude_ai_Claude_Docs__*' },
];

// Natív (nem MCP) Claude Code tool-ok, amik egy headless botnál még értelmesen engedélyezhetők.
// A Bash és más, a futtató harness-hez kötött tool-ok (Task, Workflow, CronCreate, PowerShell,
// SendMessage stb.) szándékosan nincsenek itt — azokat külön kérésre kell felvenni.
const SUGGESTED_NATIVE_TOOLS = [
  { label: 'Read', pattern: 'Read', description: 'Fájlok tartalmának beolvasása a workspace-ből.' },
  { label: 'Write', pattern: 'Write', description: 'Új fájlok létrehozása, vagy meglévők teljes felülírása a workspace-ben.' },
  { label: 'Edit', pattern: 'Edit', description: 'Célzott, részleges szövegcsere egy meglévő fájlban.' },
  { label: 'Glob', pattern: 'Glob', description: 'Fájlok keresése minta alapján (pl. *.md).' },
  { label: 'Grep', pattern: 'Grep', description: 'Szöveges keresés fájlok tartalmában.' },
  { label: 'WebFetch', pattern: 'WebFetch', description: 'Egy adott URL tartalmának lekérése és feldolgozása.' },
  { label: 'WebSearch', pattern: 'WebSearch', description: 'Webes keresés friss, a tréning-adatokon túli információkhoz.' },
  { label: 'Skill', pattern: 'Skill', description: 'Egy telepített skill (.claude/skills/ alatt) explicit meghívása.' },
];

const MODEL_OPTIONS = [
  { label: 'Alapértelmezett', value: '' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Opus', value: 'opus' },
  { label: 'Fable', value: 'fable' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
];

const EFFORT_OPTIONS = [
  { label: 'Alapértelmezett', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Xhigh', value: 'xhigh' },
  { label: 'Max', value: 'max' },
];

/** A `claude --permission-mode` hat értéke. A sorrend és a címkézés a terminál Shift+Tab
 *  ciklusát követi (Manual → Accept edits → Plan → Auto), utána jön a két olyan mód, ami a
 *  terminálban nem ciklizálható. A `manual` a CLI-ben a `default` aliasa — a terminál
 *  státuszsorában "default" néven látszik ugyanez a mód. */
const PERMISSION_MODE_OPTIONS = [
  {
    label: 'Manual',
    value: 'manual',
    description: 'Veszélyes műveleteknél engedélyt kér. A terminálban ez a „default” mód.',
  },
  {
    label: 'Accept edits',
    value: 'acceptEdits',
    description: 'A fájlszerkesztéseket magától elfogadja, minden másra engedélyt kér.',
  },
  {
    label: 'Plan',
    value: 'plan',
    description: 'Tervezési mód: a bot nem futtat tool-t, csak tervet készít.',
  },
  {
    label: 'Auto',
    value: 'auto',
    description: 'Az engedélykérésekről egy modell-osztályozó dönt.',
  },
  {
    label: "Don't ask",
    value: 'dontAsk',
    description: 'Soha nem kérdez: amit az engedélyezett tool-ok nem fednek, azt elutasítja.',
  },
  {
    label: 'Bypass permissions',
    value: 'bypassPermissions',
    description: 'Minden engedélyellenőrzést kihagy. Csak megbízható munkamappánál.',
  },
];

/** Ezekben a módokban a CLI a saját engedélyfolyamatában dönt a tool-hívásokról, és el sem jut
 *  a `--permission-prompt-tool`-ig — az interaktív jóváhagyás (UC-018) ilyenkor hatástalan.
 *  A bot saját kérdéseit (AskUserQuestion, UC-020) viszont továbbra is ez a csatorna hozza,
 *  ezért a kapcsolót nem tiltjuk le, csak figyelmeztetünk. */
const MODES_WITHOUT_PROMPTING = ['dontAsk', 'bypassPermissions'];

/** Skill/sub agent chipek "Megosztott" (Bots/.claude/) és workspace-specifikus csoportokra
 *  bontva — ugyanaz a subtitle+chips minta, mint az engedélyezett tool-oknál az MCP szerverek /
 *  Natív tool-ok felosztás. A megosztottak ténylegesen minden botnál élnek: a claude.exe a
 *  munkakönyvtárból felfelé haladva magától felveszi őket, nem csak a megjelenítés közös. */
function CapabilityGroups({ items, emptyNote }: { items: CapabilityInfo[]; emptyNote: string }) {
  if (items.length === 0) {
    return <span className="settings-empty-note">{emptyNote}</span>;
  }

  const shared = items.filter((i) => i.shared);
  const own = items.filter((i) => !i.shared);

  function renderChips(list: CapabilityInfo[]) {
    return (
      <div className="settings-tools__chips">
        {list.map((item) => (
          <span key={item.name} className="tool-chip tool-chip--readonly" tabIndex={0}>
            {item.name}
            {item.description && <span className="info-icon__tooltip">{item.description}</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <>
      {shared.length > 0 && (
        <>
          <span className="settings-tools__subtitle">Megosztott (minden bot eléri)</span>
          {renderChips(shared)}
        </>
      )}
      {own.length > 0 && (
        <>
          <span className="settings-tools__subtitle">Ebben a workspace-ben</span>
          {renderChips(own)}
        </>
      )}
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function draftFromBot(bot: Bot): BotSettingsDraft {
  return {
    name: bot.name,
    allowedTools: bot.allowedTools,
    model: bot.model,
    effort: bot.effort,
    permissionMode: bot.permissionMode,
    interactiveApproval: bot.interactiveApproval,
    channelEnabled: bot.channelEnabled,
  };
}

function draftsEqual(a: BotSettingsDraft, b: BotSettingsDraft): boolean {
  return (
    a.name === b.name &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.permissionMode === b.permissionMode &&
    a.interactiveApproval === b.interactiveApproval &&
    a.channelEnabled === b.channelEnabled &&
    a.allowedTools.length === b.allowedTools.length &&
    a.allowedTools.every((t, i) => t === b.allowedTools[i])
  );
}

export function SettingsView({
  bot,
  open,
  activeTab,
  onTabChange,
  details,
  error,
  onClose,
  onSetAvatar,
  onSave,
  onDirtyChange,
  onRequestDelete,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<BotSettingsDraft | null>(bot ? draftFromBot(bot) : null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Csak bot-váltáskor (más id) töltjük újra a draftot a bot aktuális állapotából — így egy
  // élő botStatusChanged/botList frissítés nem írja felül a félkész, még nem mentett szerkesztést.
  useEffect(() => {
    setDraft(bot ? draftFromBot(bot) : null);
    setIsEditingName(false);
    setShowCloseConfirm(false);
  }, [bot?.id]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const isDirty = bot && draft ? !draftsEqual(draft, draftFromBot(bot)) : false;

  // A hosztnak (WinForms) is jeleznünk kell, hogy van-e mentetlen módosítás, hogy alkalmazás-
  // bezáráskor (FormClosing) ott is rá tudjon kérdezni, ne csak a beállítások lap bezárásakor.
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  if (!bot || !draft) return null;

  const approvalIneffective = MODES_WITHOUT_PROMPTING.includes(draft.permissionMode);

  function requestClose() {
    if (isDirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }

  function discardAndClose() {
    setDraft(draftFromBot(bot!));
    setShowCloseConfirm(false);
    onClose();
  }

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    onSetAvatar(file.type || 'image/png', dataBase64);
  }

  function updateDraft(patch: Partial<BotSettingsDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function toggleTool(pattern: string) {
    const isEnabled = draft!.allowedTools.includes(pattern);
    updateDraft({
      allowedTools: isEnabled
        ? draft!.allowedTools.filter((t) => t !== pattern)
        : [...draft!.allowedTools, pattern],
    });
  }

  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      setIsEditingName(false);
    } else if (e.key === 'Escape') {
      updateDraft({ name: bot!.name });
      setIsEditingName(false);
    }
  }

  function handleSave() {
    const trimmedName = draft!.name.trim();
    if (!trimmedName) return;
    onSave({ ...draft!, name: trimmedName });
  }

  // Az ismert minták mindig megjelennek (engedélyezett/nem-engedélyezett állapottal), plusz
  // minden, korábban (pl. a régi szabadszöveges mezővel) felvett egyedi minta is — hogy ne
  // tűnjön el némán egy már elmentett, de a listán kívüli minta.
  const mcpToolChips = [
    ...SUGGESTED_TOOL_PATTERNS,
    ...draft.allowedTools
      .filter(
        (p) =>
          !SUGGESTED_TOOL_PATTERNS.some((s) => s.pattern === p) &&
          !SUGGESTED_NATIVE_TOOLS.some((s) => s.pattern === p),
      )
      .map((p) => ({ label: p, pattern: p })),
  ];
  const nativeToolChips = SUGGESTED_NATIVE_TOOLS;

  return (
    <div className={`settings-view${open ? ' settings-view--open' : ''}`}>
      {error && <div className="settings-view__error">{error}</div>}

      {showCloseConfirm && (
        <ConfirmDialog
          title="Mentetlen változtatások"
          message="A beállításokon végzett módosítások nincsenek elmentve. Biztosan bezárod a beállítások lapot mentés nélkül?"
          onCancel={() => setShowCloseConfirm(false)}
          onConfirm={discardAndClose}
        />
      )}

      <div className="settings-view__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-tab${activeTab === t.id ? ' settings-tab--active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="settings-view__tabs-spacer" />
        {isDirty && (
          <button type="button" className="settings-view__save" onClick={handleSave}>
            Mentés
          </button>
        )}
        <button type="button" className="settings-view__close" onClick={requestClose} aria-label="Bezárás">
          ×
        </button>
      </div>

      <div className="settings-view__body">
        {activeTab === 'settings' && (
          <>
            <button
              type="button"
              className="settings-avatar"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Bot képének módosítása"
            >
              {bot.avatarDataUrl ? (
                <img src={bot.avatarDataUrl} alt="" className="settings-avatar__image" />
              ) : (
                <span className="settings-avatar__placeholder">
                  {(draft.name || bot.name).charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="settings-view__file-input"
              onChange={handleAvatarChange}
            />

            <div className="settings-name">
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  className="settings-name__input"
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  onKeyDown={handleNameKeyDown}
                  onBlur={() => setIsEditingName(false)}
                />
              ) : (
                <div className="settings-name__static">
                  <span className="settings-name__text">{draft.name}</span>
                  <button
                    type="button"
                    className="settings-name__edit"
                    onClick={() => setIsEditingName(true)}
                    aria-label="Bot nevének szerkesztése"
                  >
                    ✎
                  </button>
                </div>
              )}
            </div>

            <div className="settings-field">
              <label className="settings-field__label" id="settings-model-label">
                Model
              </label>
              <Select
                ariaLabel="Model"
                value={draft.model ?? ''}
                onChange={(v) => updateDraft({ model: v || null })}
                options={MODEL_OPTIONS}
              />
            </div>

            <div className="settings-field">
              <label className="settings-field__label" id="settings-effort-label">
                Effort
              </label>
              <Select
                ariaLabel="Effort"
                value={draft.effort ?? ''}
                onChange={(v) => updateDraft({ effort: v || null })}
                options={EFFORT_OPTIONS}
              />
            </div>

            <div className="settings-field">
              <label className="settings-field__label" id="settings-permission-mode-label">
                Permission mode
              </label>
              <Select
                ariaLabel="Permission mode"
                value={draft.permissionMode}
                onChange={(v) => updateDraft({ permissionMode: v })}
                options={PERMISSION_MODE_OPTIONS}
              />
            </div>

            <div className="settings-toggle-field">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  className="settings-toggle__input"
                  checked={draft.interactiveApproval}
                  onChange={(e) => updateDraft({ interactiveApproval: e.target.checked })}
                />
                <span className="settings-toggle__text">Interaktív jóváhagyás kérése</span>
              </label>
              <p className="settings-toggle__hint">
                Ha a bot olyan eszközt használna, ami nincs engedélyezve, a csevegésben
                rákérdez. Kikapcsolva az ilyen hívások elutasításra kerülnek, kérdés nélkül.
              </p>
              {approvalIneffective && (
                <p className="settings-toggle__hint settings-toggle__hint--warning">
                  A kiválasztott Permission mode-ban a bot nem kér tool-engedélyt — a kapcsoló
                  ilyenkor csak a bot saját kérdéseire van hatással. Hagyd bekapcsolva, hogy
                  azokra válaszolni tudj.
                </p>
              )}
            </div>

            <div className="settings-danger">
              <span className="settings-danger__label">
                A bot és teljes munkamappája véglegesen törlődik.
              </span>
              <button type="button" className="settings-danger__button" onClick={onRequestDelete}>
                Bot törlése
              </button>
            </div>
          </>
        )}

        {activeTab === 'definition' && (
          <div className="settings-definition">
            {details?.agentDefinition ? (
              <pre className="settings-definition__content">{details.agentDefinition}</pre>
            ) : (
              <span className="settings-empty-note">
                Még nincs agent.md ebben a workspace-ben.
              </span>
            )}
          </div>
        )}

        {activeTab === 'capabilities' && (
          <>
            <div className="settings-tools">
              <div className="settings-tools__header">
                <span className="settings-tools__title">Engedélyezett tool-ok</span>
                <span className="info-icon" tabIndex={0}>
                  ⓘ
                  <span className="info-icon__tooltip">
                    A claude.exe headless módban fut, nincs felugró jóváhagyás — csak az itt
                    kiválasztott minták kapnak automatikus engedélyt. A Bash és a futtató-harness
                    egyéb tool-jai (Task, Workflow, CronCreate stb.) innen szándékosan nem
                    engedélyezhetők.
                  </span>
                </span>
              </div>

              <span className="settings-tools__subtitle">MCP szerverek</span>
              <div className="settings-tools__chips">
                {/* A bot-csatorna (UC-021) a hoszt saját MCP szervere. A többi chiptől eltérően
                    NEM az allowedTools listát kapcsolja: a részvételt a busz érvényesíti
                    futásidőben, ezért a ki/bekapcsolás nem indítja újra a botot. A felhasználó
                    felé viszont ugyanaz a kérdés ("használhatja-e ezt a bot"), ezért itt, a többi
                    MCP szerver között a helye. */}
                <button
                  type="button"
                  className={`tool-chip${
                    draft.channelEnabled ? ' tool-chip--enabled' : ' tool-chip--disabled'
                  }`}
                  onClick={() => updateDraft({ channelEnabled: !draft.channelEnabled })}
                >
                  Bot-csatorna
                  <span className="tool-chip__icon">{draft.channelEnabled ? '×' : '+'}</span>
                  <span className="info-icon__tooltip">
                    A többi bottal való üzenetváltás (list_bots, send_message, recent_messages):
                    a bot feladatot delegálhat nekik és válaszolhat a kérdéseikre. A forgalom
                    mindkét fél csevegésében látszik. Kikapcsolva se nem küld, se nem kap
                    üzenetet — a bot újraindítása nélkül.
                  </span>
                </button>
                {mcpToolChips.map((t) => {
                  const isEnabled = draft.allowedTools.includes(t.pattern);
                  return (
                    <button
                      key={t.pattern}
                      type="button"
                      className={`tool-chip${isEnabled ? ' tool-chip--enabled' : ' tool-chip--disabled'}`}
                      onClick={() => toggleTool(t.pattern)}
                    >
                      {t.label}
                      <span className="tool-chip__icon">{isEnabled ? '×' : '+'}</span>
                    </button>
                  );
                })}
              </div>

              <span className="settings-tools__subtitle">Natív tool-ok</span>
              <div className="settings-tools__chips">
                {nativeToolChips.map((t) => {
                  const isEnabled = draft.allowedTools.includes(t.pattern);
                  return (
                    <button
                      key={t.pattern}
                      type="button"
                      className={`tool-chip${isEnabled ? ' tool-chip--enabled' : ' tool-chip--disabled'}`}
                      onClick={() => toggleTool(t.pattern)}
                    >
                      {t.label}
                      <span className="tool-chip__icon">{isEnabled ? '×' : '+'}</span>
                      {t.description && <span className="info-icon__tooltip">{t.description}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-tools">
              <div className="settings-tools__header">
                <span className="settings-tools__title">Sub agentek</span>
                <span className="info-icon" tabIndex={0}>
                  ⓘ
                  <span className="info-icon__tooltip">
                    A workspace .claude/agents/ mappájában, illetve a minden bot között közös
                    Bots/.claude/agents/ mappában található sub agent-definíciók listája. Ez csak
                    megjelenítés — a sub agentek hozzáadása/szerkesztése nem a felületről
                    történik.
                  </span>
                </span>
              </div>
              <CapabilityGroups
                items={details?.subAgents ?? []}
                emptyNote="Nincs egyedi sub agent ebben a workspace-ben."
              />
            </div>

            <div className="settings-tools">
              <div className="settings-tools__header">
                <span className="settings-tools__title">Skillek</span>
                <span className="info-icon" tabIndex={0}>
                  ⓘ
                  <span className="info-icon__tooltip">
                    A workspace .claude/skills/ mappájában, illetve a minden bot között közös
                    Bots/.claude/skills/ mappában található skillek listája. Ez csak megjelenítés —
                    a skillek hozzáadása/szerkesztése nem a felületről történik.
                  </span>
                </span>
              </div>
              <CapabilityGroups
                items={details?.skills ?? []}
                emptyNote="Nincs skill ebben a workspace-ben."
              />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
