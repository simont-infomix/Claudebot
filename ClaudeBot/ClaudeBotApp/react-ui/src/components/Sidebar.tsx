import type { Bot } from '../types';
import './Sidebar.css';

interface Props {
  bots: Bot[];
  selectedBotId: string | null;
  onSelect: (botId: string) => void;
  onAddClick: () => void;
}

export function Sidebar({ bots, selectedBotId, onSelect, onAddClick }: Props) {
  return (
    <div className="sidebar">
      {bots.map((bot) => (
        <button
          key={bot.id}
          type="button"
          className={`avatar${bot.id === selectedBotId ? ' avatar--selected' : ''}`}
          onClick={() => onSelect(bot.id)}
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
    </div>
  );
}
