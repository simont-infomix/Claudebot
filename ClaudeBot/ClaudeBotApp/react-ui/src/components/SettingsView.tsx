import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Bot, BotSettingsDraft } from '../types';
import { Select } from './Select';
import './SettingsView.css';

interface Props {
  bot: Bot | null;
  open: boolean;
  error: string | null;
  onClose: () => void;
  onSetAvatar: (contentType: string, dataBase64: string) => void;
  onSave: (settings: BotSettingsDraft) => void;
}

// Gyors hozzáadás gombok: a leggyakrabban használt MCP-szerverek wildcard-mintái. Nem egy élő
// szerverlistából generálódnak — ha új MCP-szerver kerül bekötésre, ide is fel kell venni.
const SUGGESTED_TOOL_PATTERNS = [
  { label: 'Összes MCP tool', pattern: 'mcp__*' },
  { label: 'Azure DevOps', pattern: 'mcp__azure-devops__*' },
  { label: 'Todo MCP', pattern: 'mcp__todo-mcp__*' },
  { label: 'Microsoft 365', pattern: 'mcp__claude_ai_Microsoft_365__*' },
  { label: 'Claude Docs', pattern: 'mcp__claude_ai_Claude_Docs__*' },
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

const PERMISSION_MODE_OPTIONS = [
  { label: 'acceptEdits', value: 'acceptEdits' },
  { label: 'auto', value: 'auto' },
  { label: 'bypassPermissions', value: 'bypassPermissions' },
  { label: 'manual', value: 'manual' },
  { label: 'dontAsk', value: 'dontAsk' },
  { label: 'plan', value: 'plan' },
];

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
  };
}

function draftsEqual(a: BotSettingsDraft, b: BotSettingsDraft): boolean {
  return (
    a.name === b.name &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.permissionMode === b.permissionMode &&
    a.allowedTools.length === b.allowedTools.length &&
    a.allowedTools.every((t, i) => t === b.allowedTools[i])
  );
}

export function SettingsView({ bot, open, error, onClose, onSetAvatar, onSave }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<BotSettingsDraft | null>(bot ? draftFromBot(bot) : null);
  const [isEditingName, setIsEditingName] = useState(false);

  // Csak bot-váltáskor (más id) töltjük újra a draftot a bot aktuális állapotából — így egy
  // élő botStatusChanged/botList frissítés nem írja felül a félkész, még nem mentett szerkesztést.
  useEffect(() => {
    setDraft(bot ? draftFromBot(bot) : null);
    setIsEditingName(false);
  }, [bot?.id]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  if (!bot || !draft) return null;

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

  const isDirty = !draftsEqual(draft, draftFromBot(bot));

  // Az ismert minták mindig megjelennek (engedélyezett/nem-engedélyezett állapottal), plusz
  // minden, korábban (pl. a régi szabadszöveges mezővel) felvett egyedi minta is — hogy ne
  // tűnjön el némán egy már elmentett, de a listán kívüli minta.
  const toolChips = [
    ...SUGGESTED_TOOL_PATTERNS,
    ...draft.allowedTools
      .filter((p) => !SUGGESTED_TOOL_PATTERNS.some((s) => s.pattern === p))
      .map((p) => ({ label: p, pattern: p })),
  ];

  return (
    <div className={`settings-view${open ? ' settings-view--open' : ''}`}>
      <button type="button" className="settings-view__back" onClick={onClose} aria-label="Vissza">
        ←
      </button>

      {isDirty && (
        <button type="button" className="settings-view__save" onClick={handleSave}>
          Mentés
        </button>
      )}

      {error && <div className="settings-view__error">{error}</div>}

      <div className="settings-view__body">
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

        <div className="settings-tools">
          <div className="settings-tools__header">
            <span className="settings-tools__title">Engedélyezett tool-ok</span>
            <span className="info-icon" tabIndex={0}>
              ⓘ
              <span className="info-icon__tooltip">
                A claude.exe headless módban fut, nincs felugró jóváhagyás — csak az itt
                kiválasztott minták kapnak automatikus engedélyt. Natív tool-ok (Bash stb.) innen
                szándékosan nem engedélyezhetők.
              </span>
            </span>
          </div>

          <div className="settings-tools__chips">
            {toolChips.map((t) => {
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
        </div>
      </div>
    </div>
  );
}
