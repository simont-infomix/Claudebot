import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Bot } from '../types';
import './SettingsView.css';

interface Props {
  bot: Bot | null;
  open: boolean;
  onClose: () => void;
  onSetAvatar: (contentType: string, dataBase64: string) => void;
  onSetName: (name: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SettingsView({ bot, open, onClose, onSetAvatar, onSetName }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(bot?.name ?? '');

  useEffect(() => {
    if (!isEditingName) {
      setNameDraft(bot?.name ?? '');
    }
  }, [bot?.name, isEditingName]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  if (!bot) return null;

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    onSetAvatar(file.type || 'image/png', dataBase64);
  }

  function commitName() {
    const trimmed = nameDraft.trim();
    setIsEditingName(false);
    if (trimmed && trimmed !== bot!.name) {
      onSetName(trimmed);
    } else {
      setNameDraft(bot!.name);
    }
  }

  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commitName();
    } else if (e.key === 'Escape') {
      setNameDraft(bot!.name);
      setIsEditingName(false);
    }
  }

  return (
    <div className={`settings-view${open ? ' settings-view--open' : ''}`}>
      <button type="button" className="settings-view__back" onClick={onClose} aria-label="Vissza">
        ←
      </button>
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
            <span className="settings-avatar__placeholder">{bot.name.charAt(0).toUpperCase()}</span>
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
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={commitName}
            />
          ) : (
            <div className="settings-name__static">
              <span className="settings-name__text">{bot.name}</span>
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
      </div>
    </div>
  );
}
