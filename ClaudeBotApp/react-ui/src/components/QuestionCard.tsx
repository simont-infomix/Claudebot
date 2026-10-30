import { useEffect, useState } from 'react';
import type { PermissionDecision, PermissionRequest } from '../types';
import './QuestionCard.css';

interface Props {
  request: PermissionRequest;
  /** 'pending' amíg válaszra vár; utána a végleges döntés. */
  decision: PermissionDecision;
  onAnswer: (requestId: string, answers: Record<string, string | string[]>) => void;
  onSkip: (requestId: string) => void;
}

const DECISION_LABEL: Record<string, string> = {
  answered: 'Megválaszolva',
  skipped: 'Kihagyva — nem érkezett válasz',
  timedOut: 'Nem érkezett válasz időben — a kérdés megválaszolatlan maradt',
  cancelled: 'A kérdés érvénytelenné vált (a bot leállt vagy újraindult)',
};

function formatRemaining(expiresAt: string, now: number): string | null {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(remainingMs) || remainingMs <= 0) return null;

  const minutes = Math.ceil(remainingMs / 60000);
  return minutes <= 1 ? 'kevesebb mint egy perc' : `${minutes} perc`;
}

/**
 * A bot AskUserQuestion tool-t hívott (UC-020) — ez NEM jóváhagyást kér, hanem ténylegesen
 * választ vár, mielőtt folytatná a kört. Minden kérdéshez legalább egy opciót ki kell
 * választani a Küldés engedélyezéséhez; a Kihagyom gomb bármikor azonnal lezárja válasz nélkül.
 */
export function QuestionCard({ request, decision, onAnswer, onSkip }: Props) {
  const questions = request.questions ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const pending = decision === 'pending' && !submitted;

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [pending]);

  function toggleOption(question: string, label: string, multiSelect: boolean) {
    setSelected((prev) => {
      const current = prev[question] ?? [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [question]: next };
      }
      return { ...prev, [question]: [label] };
    });
  }

  function submit() {
    // Minden kérdésnek legalább egy választ kell adni — enélkül a Küldés gomb le van tiltva.
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const picks = selected[q.question] ?? [];
      if (picks.length === 0) return;
      answers[q.question] = q.multiSelect ? picks : picks[0];
    }
    setSubmitted(true);
    onAnswer(request.requestId, answers);
  }

  function skip() {
    setSubmitted(true);
    onSkip(request.requestId);
  }

  const allAnswered = questions.every((q) => (selected[q.question]?.length ?? 0) > 0);
  const remaining = formatRemaining(request.expiresAt, now);
  const stateClass = pending ? 'pending' : decision === 'pending' ? 'answered' : decision;

  return (
    <div className={`question-card question-card--${stateClass}`}>
      <div className="question-card__head">
        <span className="question-card__icon" aria-hidden="true">
          ❓
        </span>
        <span className="question-card__title">A bot kérdez</span>
        {request.isScheduledRun && (
          <span className="question-card__badge">ütemezett futás</span>
        )}
      </div>

      {questions.map((q) => (
        <div key={q.question} className="question-card__question">
          {q.header && <span className="question-card__header-label">{q.header}</span>}
          <p className="question-card__text">{q.question}</p>
          <div className="question-card__options">
            {q.options.map((opt) => {
              const isSelected = (selected[q.question] ?? []).includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  disabled={!pending}
                  className={`question-card__option${isSelected ? ' question-card__option--selected' : ''}`}
                  onClick={() => toggleOption(q.question, opt.label, q.multiSelect)}
                  title={opt.description ?? undefined}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {pending ? (
        <>
          <div className="question-card__actions">
            <button
              type="button"
              className="question-card__btn question-card__btn--submit"
              disabled={!allAnswered}
              onClick={submit}
            >
              Küldés
            </button>
            <button type="button" className="question-card__btn question-card__btn--skip" onClick={skip}>
              Kihagyom
            </button>
          </div>
          {remaining && (
            <p className="question-card__hint">
              Válasz nélkül {remaining} múlva a bot válasz nélkül folytatja.
            </p>
          )}
        </>
      ) : (
        <p className="question-card__outcome">
          {decision === 'pending' ? 'Válasz küldése…' : DECISION_LABEL[decision] ?? decision}
        </p>
      )}
    </div>
  );
}
