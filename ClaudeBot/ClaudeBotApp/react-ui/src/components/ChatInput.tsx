import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { EncodedAttachment } from '../types';
import sendIcon from '../assets/send.png';
import { AttachmentChip } from './AttachmentChip';
import './ChatInput.css';

interface Attachment {
  id: string;
  file: File;
  name: string;
}

interface Props {
  disabled?: boolean;
  onSend: (text: string, attachments: EncodedAttachment[]) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function nameForFile(file: File): string {
  if (file.name) return file.name;
  const ext = file.type.split('/')[1] || 'bin';
  return `paste-${Date.now()}.${ext}`;
}

export function ChatInput({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${Date.now()}-${Math.random()}`,
        file,
        name: nameForFile(file),
      })),
    ]);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSend() {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;

    const encoded = await Promise.all(
      attachments.map(async (a) => ({ name: a.name, dataBase64: await fileToBase64(a.file) })),
    );

    onSend(trimmed, encoded);
    setValue('');
    setAttachments([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleDrop(e: DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);

    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  return (
    <div className="chat-input-area">
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} name={a.name} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}
      <div className="chat-input">
        <textarea
          ref={textareaRef}
          className="chat-input__field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
          placeholder="Írj üzenetet..."
          disabled={disabled}
          rows={1}
        />
        <button
          type="button"
          className="chat-input__send"
          onClick={handleSend}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          aria-label="Üzenet küldése"
        >
          <img src={sendIcon} alt="" className="chat-input__send-icon" />
        </button>
      </div>
    </div>
  );
}
