import { useEffect, useRef, useState } from 'react';
import type {
  Bot,
  EncodedAttachment,
  LogLine,
  PermissionAnswer,
  PermissionDecision,
  PermissionRequest,
} from '../types';
import { ChatInput } from './ChatInput';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import './ChatView.css';

interface Props {
  bot: Bot | null;
  logs: LogLine[];
  /** A bot jóváhagyási kérései (és kérdései, UC-020) requestId szerint — a chat 'permission'
   *  sorai ebből kapják az élő állapotukat (UC-018). */
  permissions: Record<string, { request: PermissionRequest; decision: PermissionDecision }>;
  onRespondPermission: (requestId: string, answer: PermissionAnswer) => void;
  onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void;
  onSkipQuestion: (requestId: string) => void;
  onSendPrompt: (text: string, attachments: EncodedAttachment[]) => void;
}

type RenderBlock =
  | { type: 'line'; key: string; line: LogLine }
  | { type: 'permission'; key: string; requestId: string; fallbackText: string }
  | { type: 'thinking'; key: string; lines: LogLine[]; isLast: boolean };

// Az egymás után érkező 'thinking' sorokat (tool_use/thinking tartalomblokkok, illetve a
// küldéskor rögtön felvillanó "Gondolkodik…" jelzés) egyetlen összecsukható blokká vonja össze —
// ezek a köztes jelzések, a tényleges válasz (assistant) mindig önálló buborékként jelenik meg.
function buildBlocks(logs: LogLine[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let i = 0;

  while (i < logs.length) {
    const line = logs[i];

    if (line.kind === 'thinking') {
      const start = i;
      const group: LogLine[] = [];
      while (i < logs.length && logs[i].kind === 'thinking') {
        group.push(logs[i]);
        i++;
      }
      blocks.push({ type: 'thinking', key: `thinking-${start}`, lines: group, isLast: i === logs.length });
    } else if (line.kind === 'permission' && line.requestId) {
      // Saját blokktípus, nem 'line': a jóváhagyási kártya interaktív (gombjai vannak), ezért
      // nem oldható meg a buborék CSS-módosítójával, mint a többi sortípus.
      blocks.push({ type: 'permission', key: `perm-${line.requestId}`, requestId: line.requestId, fallbackText: line.text });
      i++;
    } else {
      blocks.push({ type: 'line', key: `line-${i}`, line });
      i++;
    }
  }

  return blocks;
}

export function ChatView({
  bot,
  logs,
  permissions,
  onRespondPermission,
  onAnswerQuestion,
  onSkipQuestion,
  onSendPrompt,
}: Props) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedOverride({});
  }, [bot?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  const blocks = buildBlocks(logs);

  return (
    <div className="content">
      <div className="chat-frame">
        {logs.length === 0 ? (
          <div className="chat-placeholder">Még nincs üzenet</div>
        ) : (
          <div className="chat-messages">
            {blocks.map((block) => {
              if (block.type === 'line') {
                const { line } = block;
                return (
                  <div key={block.key} className={`chat-row chat-row--${line.kind}`}>
                    <div className={`chat-bubble chat-bubble--${line.kind}`}>{line.text}</div>
                  </div>
                );
              }

              if (block.type === 'permission') {
                const entry = permissions[block.requestId];

                // A beszélgetés túléli a bot újraindítását, a kérés azonosítója viszont nem —
                // ilyenkor csak a horgony-sor szövege marad meg, kártya nélkül.
                if (!entry) {
                  return (
                    <div key={block.key} className="chat-row chat-row--info">
                      <div className="chat-bubble chat-bubble--info">{block.fallbackText}</div>
                    </div>
                  );
                }

                // A bot vagy engedélyt kér (allow/allowAlways/deny), vagy — AskUserQuestion
                // esetén — ténylegesen választ vár: ez két külön kártya-típus, mert a UI és a
                // válasz-alak is eltér (gombok vs. kérdés+opciók).
                return (
                  <div key={block.key} className="chat-row chat-row--permission">
                    {entry.request.questions && entry.request.questions.length > 0 ? (
                      <QuestionCard
                        request={entry.request}
                        decision={entry.decision}
                        onAnswer={onAnswerQuestion}
                        onSkip={onSkipQuestion}
                      />
                    ) : (
                      <PermissionCard
                        request={entry.request}
                        decision={entry.decision}
                        onRespond={onRespondPermission}
                      />
                    )}
                  </div>
                );
              }

              const isOpen = expandedOverride[block.key] ?? block.isLast;

              return (
                <div key={block.key} className="thinking-block">
                  <button
                    type="button"
                    className="thinking-block__toggle"
                    onClick={() =>
                      setExpandedOverride((prev) => ({ ...prev, [block.key]: !isOpen }))
                    }
                  >
                    <span className={`thinking-block__chevron${isOpen ? ' thinking-block__chevron--open' : ''}`}>
                      ▸
                    </span>
                    Effort
                  </button>
                  {isOpen && (
                    <div className="thinking-block__body">
                      {block.lines.map((line, idx) => (
                        <div key={idx} className="thinking-line">
                          {line.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
      <ChatInput disabled={!bot} onSend={onSendPrompt} />
    </div>
  );
}
