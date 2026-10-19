import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import sendIcon from '../assets/send.png';
import './ChatInput.css';

interface Props {
  disabled?: boolean;
  onSend: (text: string) => void;
}

export function ChatInput({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        className="chat-input__field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Írj üzenetet..."
        disabled={disabled}
        rows={1}
      />
      <button
        type="button"
        className="chat-input__send"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label="Üzenet küldése"
      >
        <img src={sendIcon} alt="" className="chat-input__send-icon" />
      </button>
    </div>
  );
}
