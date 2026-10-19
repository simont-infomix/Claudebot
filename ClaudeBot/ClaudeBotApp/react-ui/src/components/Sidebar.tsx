import { useState, type MouseEvent } from 'react';
import type { Bot } from '../types';
import { BotContextMenu } from './BotContextMenu';
import './Sidebar.css';

interface Props {
  bots: Bot[];
  selectedBotId: string | null;
  onSelect: (botId: string) => void;
  onAddClick: () => void;
  onOpenSettings: (botId: string) => void;
  onOpenWorkspaceFolder: (botId: string) => void;
  onOpenTerminal: (botId: string) => void;
}

export function Sidebar({
  bots,
  selectedBotId,
  onSelect,
  onAddClick,
  onOpenSettings,
  onOpenWorkspaceFolder,
  onOpenTerminal,
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
          {bot.name}
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
          onSettings={() => onOpenSettings(contextMenu.botId)}
          onOpenWorkspaceFolder={() => onOpenWorkspaceFolder(contextMenu.botId)}
          onOpenTerminal={() => onOpenTerminal(contextMenu.botId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
