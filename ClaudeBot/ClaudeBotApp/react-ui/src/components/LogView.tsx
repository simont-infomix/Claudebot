import { useEffect, useRef } from 'react';
import type { Bot, LogLine } from '../types';
import './LogView.css';

interface Props {
  bot: Bot | null;
  logs: LogLine[];
  onOpenTerminal: () => void;
}

export function LogView({ bot, logs, onOpenTerminal }: Props) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  return (
    <div className="content">
      <div className="top-bar">
        <button type="button" className="icon-button" aria-label="Beállítások megnyitása">
          ⚙
        </button>
      </div>
      <div className="log-frame">
        {logs.length === 0 ? (
          <div className="log-placeholder">Logok helye</div>
        ) : (
          <div className="log-text">
            {logs.map((line, i) => (
              <div key={i} className={`log-line log-line--${line.kind}`}>
                {line.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
      <div className="bottom-bar">
        <button type="button" className="btn-open" onClick={onOpenTerminal} disabled={!bot}>
          Open
        </button>
      </div>
    </div>
  );
}
