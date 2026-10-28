import { useEffect, useRef } from 'react';
import type { SettingsTab } from '../types';
import './BotContextMenu.css';

interface Props {
  x: number;
  y: number;
  onOpenSettingsTab: (tab: SettingsTab) => void;
  onOpenTasks: () => void;
  onOpenWorkspaceFolder: () => void;
  onOpenTerminal: () => void;
  onRestart: () => void;
  onClose: () => void;
}

export function BotContextMenu({
  x,
  y,
  onOpenSettingsTab,
  onOpenTasks,
  onOpenWorkspaceFolder,
  onOpenTerminal,
  onRestart,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  function handleSelect(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="context-menu" style={{ left: x, top: y }} ref={menuRef}>
      <button type="button" className="context-menu__item" onClick={() => handleSelect(() => onOpenSettingsTab('settings'))}>
        Beállítások
      </button>
      <button type="button" className="context-menu__item" onClick={() => handleSelect(() => onOpenSettingsTab('definition'))}>
        Bot definíció
      </button>
      <button type="button" className="context-menu__item" onClick={() => handleSelect(() => onOpenSettingsTab('capabilities'))}>
        Képességek
      </button>
      <button type="button" className="context-menu__item" onClick={() => handleSelect(onOpenTasks)}>
        Feladatok
      </button>
      <div className="context-menu__divider" />
      <button
        type="button"
        className="context-menu__item"
        onClick={() => handleSelect(onOpenWorkspaceFolder)}
      >
        Munka mappa megnyitása
      </button>
      <button
        type="button"
        className="context-menu__item"
        onClick={() => handleSelect(onOpenTerminal)}
      >
        Bot megnyitása Terminálban
      </button>
      <button type="button" className="context-menu__item" onClick={() => handleSelect(onRestart)}>
        Újraindítás
      </button>
    </div>
  );
}
