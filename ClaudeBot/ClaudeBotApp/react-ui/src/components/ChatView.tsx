import { useEffect, useRef } from 'react';
import type { Bot, EncodedAttachment, LogLine } from '../types';
import { ChatInput } from './ChatInput';
import './ChatView.css';

interface Props {
  bot: Bot | null;
  logs: LogLine[];
  onSendPrompt: (text: string, attachments: EncodedAttachment[]) => void;
}

export function ChatView({ bot, logs, onSendPrompt }: Props) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  return (
    <div className="content">
      <div className="chat-frame">
        {logs.length === 0 ? (
          <div className="chat-placeholder">Még nincs üzenet</div>
        ) : (
          <div className="chat-messages">
            {logs.map((line, i) => (
              <div key={i} className={`chat-row chat-row--${line.kind}`}>
                <div className={`chat-bubble chat-bubble--${line.kind}`}>{line.text}</div>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
      <ChatInput disabled={!bot} onSend={onSendPrompt} />
    </div>
  );
}
