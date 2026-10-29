import { useEffect, useRef, useState, type FormEvent } from 'react';
import './DeleteBotDialog.css';

interface Props {
  botName: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Visszafordíthatatlan művelet megerősítése (UC-016): a bot nevét pontosan be kell gépelni.
 * A begépelés tudatos súrlódás — egy sima "Biztos?" kérdést reflexből nyugtáz az ember, egy
 * nevet viszont nem lehet véletlenül leírni.
 */
export function DeleteBotDialog({ botName, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Pontos egyezés, csak a körülvevő szóközöket hagyjuk figyelmen kívül.
  const matches = typed.trim() === botName;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (matches) onConfirm();
  }

  return (
    <div className="delete-dialog-overlay" onClick={onClose}>
      <form
        className="delete-dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="delete-dialog__title">Bot törlése</div>

        <p className="delete-dialog__warning">
          A bot <strong>teljes munkamappája</strong> törlődik: a beállításai, az ütemezett
          feladatai, az agent-definíciója és minden fájlja. A művelet <strong>nem vonható
          vissza</strong>.
        </p>

        <label className="delete-dialog__label" htmlFor="delete-bot-name">
          A megerősítéshez írd be a bot nevét: <span className="delete-dialog__name">{botName}</span>
        </label>
        <input
          id="delete-bot-name"
          ref={inputRef}
          className="delete-dialog__input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="delete-dialog__actions">
          <button type="button" className="delete-dialog__cancel" onClick={onClose}>
            Mégse
          </button>
          <button type="submit" className="delete-dialog__confirm" disabled={!matches}>
            Végleges törlés
          </button>
        </div>
      </form>
    </div>
  );
}
