import { useState, type FormEvent } from 'react';
import './NewBotDialog.css';

interface Props {
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function NewBotDialog({ error, onSubmit, onClose }: Props) {
  const [name, setName] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <label htmlFor="bot-name">Bot neve:</label>
        <input
          id="bot-name"
          className={error ? 'error' : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Mégse
          </button>
          <button type="submit">OK</button>
        </div>
      </form>
    </div>
  );
}
