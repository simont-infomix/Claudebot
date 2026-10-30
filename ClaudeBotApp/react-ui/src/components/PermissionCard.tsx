import { useEffect, useState } from 'react';
import type { PermissionAnswer, PermissionDecision, PermissionRequest } from '../types';
import './PermissionCard.css';

interface Props {
  request: PermissionRequest;
  /** 'pending' amíg válaszra vár; utána a végleges döntés. */
  decision: PermissionDecision;
  onRespond: (requestId: string, answer: PermissionAnswer) => void;
}

const DECISION_LABEL: Record<Exclude<PermissionDecision, 'pending'>, string> = {
  allowed: 'Engedélyezve',
  allowedAlways: 'Engedélyezve — mostantól nem kérdez rá',
  denied: 'Elutasítva',
  // Ez a két állapot gyakorlatban csak kérdés-típusú kéréseknél (QuestionCard) fordul elő —
  // itt csak a Record teljessége miatt szerepel.
  answered: 'Megválaszolva',
  skipped: 'Kihagyva',
  timedOut: 'Nem érkezett válasz időben — automatikusan elutasítva',
  cancelled: 'A kérés érvénytelenné vált (a bot leállt vagy újraindult)',
};

/** A hátralévő idő emberi alakban. Csak percig megyünk le: a másodpercenként változó
 *  visszaszámláló a chat folyamában nyugtalan, és a döntés sem ennyire sürgős. */
function formatRemaining(expiresAt: string, now: number): string | null {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(remainingMs) || remainingMs <= 0) return null;

  const minutes = Math.ceil(remainingMs / 60000);
  return minutes <= 1 ? 'kevesebb mint egy perc' : `${minutes} perc`;
}

export function PermissionCard({ request, decision, onRespond }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const pending = decision === 'pending' && !answered;

  // Amíg válaszra vár, percenként frissítjük a hátralévő időt. Lejárt kérésnél a host küldi
  // a végleges állapotot, ezért itt nem kell magunktól elutasítottra váltani.
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [pending]);

  function respond(answer: PermissionAnswer) {
    // Azonnal letiltjuk a gombokat, hogy dupla kattintásból ne menjen ki két válasz —
    // a végleges állapotot viszont a host visszajelzése adja.
    setAnswered(true);
    onRespond(request.requestId, answer);
  }

  const remaining = formatRemaining(request.expiresAt, now);
  const stateClass = pending ? 'pending' : decision === 'pending' ? 'answered' : decision;

  return (
    <div className={`permission-card permission-card--${stateClass}`}>
      <div className="permission-card__head">
        <span className="permission-card__icon" aria-hidden="true">
          🔐
        </span>
        <span className="permission-card__title">
          Engedélyt kér: <strong>{request.toolName}</strong>
        </span>
        {request.isScheduledRun && (
          <span className="permission-card__badge">ütemezett futás</span>
        )}
      </div>

      {request.inputSummary && (
        <pre className="permission-card__summary">{request.inputSummary}</pre>
      )}

      <button
        type="button"
        className="permission-card__details-toggle"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
      >
        <span className={`permission-card__chevron${detailsOpen ? ' permission-card__chevron--open' : ''}`}>
          ▸
        </span>
        Részletek
      </button>

      {detailsOpen && (
        <pre className="permission-card__details">{request.inputJson}</pre>
      )}

      {pending ? (
        <>
          <div className="permission-card__actions">
            <button
              type="button"
              className="permission-card__btn permission-card__btn--allow"
              onClick={() => respond('allow')}
            >
              Engedélyezem
            </button>
            <button
              type="button"
              className="permission-card__btn permission-card__btn--always"
              onClick={() => respond('allowAlways')}
            >
              Mindig engedélyezd
            </button>
            <button
              type="button"
              className="permission-card__btn permission-card__btn--deny"
              onClick={() => respond('deny')}
            >
              Elutasítom
            </button>
          </div>
          {remaining && (
            <p className="permission-card__hint">
              Válasz nélkül {remaining} múlva automatikusan elutasításra kerül.
            </p>
          )}
        </>
      ) : (
        <p className="permission-card__outcome">
          {decision === 'pending' ? 'Válasz küldése…' : DECISION_LABEL[decision]}
        </p>
      )}
    </div>
  );
}
