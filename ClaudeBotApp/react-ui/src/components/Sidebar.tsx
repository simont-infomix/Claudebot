import { useState, type MouseEvent } from 'react';
import type { Bot, SettingsTab } from '../types';
import { BotContextMenu } from './BotContextMenu';
import './Sidebar.css';

interface Props {
  bots: Bot[];
  selectedBotId: string | null;
  onSelect: (botId: string) => void;
  onAddClick: () => void;
  onOpenSettings: (botId: string, tab: SettingsTab) => void;
  onOpenTasks: (botId: string) => void;
  onOpenWorkspaceFolder: (botId: string) => void;
  onOpenTerminal: (botId: string) => void;
  onRestart: (botId: string) => void;
}

export function Sidebar({
  bots,
  selectedBotId,
  onSelect,
  onAddClick,
  onOpenSettings,
  onOpenTasks,
  onOpenWorkspaceFolder,
  onOpenTerminal,
  onRestart,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ botId: string; x: number; y: number } | null>(
    null,
  );

  function handleContextMenu(e: MouseEvent<HTMLButtonElement>, botId: string) {
    e.preventDefault();
    setContextMenu({ botId, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="sidebar">
      {bots.map((bot) => (
        <button
          key={bot.id}
          type="button"
          className={`avatar${bot.id === selectedBotId ? ' avatar--selected' : ''}`}
          onClick={() => onSelect(bot.id)}
          onContextMenu={(e) => handleContextMenu(e, bot.id)}
          title={bot.name}
        >
          <span className={`status-dot status-dot--${bot.status}`} />
          {bot.hasUnreadMessage && (
            <span className="unread-badge" aria-label="Olvasatlan üzenet" />
          )}
          {bot.avatarDataUrl ? (
            <img src={bot.avatarDataUrl} alt="" className="avatar__image" />
          ) : (
            bot.name
          )}
        </button>
      ))}
      <button
        type="button"
        className="avatar avatar--add"
        onClick={onAddClick}
        aria-label="Új bot létrehozása"
      >
        +
      </button>
      {contextMenu && (
        <BotContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onOpenSettingsTab={(tab) => onOpenSettings(contextMenu.botId, tab)}
          onOpenTasks={() => onOpenTasks(contextMenu.botId)}
          onOpenWorkspaceFolder={() => onOpenWorkspaceFolder(contextMenu.botId)}
          onOpenTerminal={() => onOpenTerminal(contextMenu.botId)}
          onRestart={() => onRestart(contextMenu.botId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
