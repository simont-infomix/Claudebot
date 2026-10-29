import type { ScheduledTask, TaskRun, TaskSchedule } from '../types';
import './TaskCard.css';

interface Props {
  task: ScheduledTask;
  onRunNow: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const DAY_NAMES = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
const DAY_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
const MONTH_SHORT = [
  'jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.',
  'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.',
];

/** Az ütemezést emberi mondattá alakítja, pl. "Hétköznap 08:00", "6 óránként". */
export function formatSchedule(schedule: TaskSchedule): string {
  if (schedule.type === 'interval') {
    const total = schedule.intervalMinutes ?? 0;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    if (hours > 0 && minutes > 0) return `${hours} óra ${minutes} percenként`;
    if (hours > 0) return hours === 1 ? 'Óránként' : `${hours} óránként`;
    return `${minutes} percenként`;
  }

  const time = schedule.timeOfDay ?? '';

  if (schedule.type === 'monthly') {
    const monthDays = [...(schedule.daysOfMonth ?? [])].sort((a, b) => a - b);
    if (monthDays.length === 0) return `Havonta ${time}`;
    // Sok kijelölt napnál a felsorolás szétfeszítené a kártyát, ezért csak a darabszám látszik.
    if (monthDays.length > 4) return `Havonta ${monthDays.length} napon ${time}`;
    return `Havonta ${monthDays.map((d) => `${d}.`).join(', ')} ${time}`;
  }

  const days = schedule.daysOfWeek ?? [];
  if (days.length === 0) return `Hetente ${time}`;
  if (days.length === 7) return `Naponta ${time}`;

  const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
  if (isWeekdays) return `Hétköznap ${time}`;

  const isWeekend = days.length === 2 && days.includes(0) && days.includes(6);
  if (isWeekend) return `Hétvégén ${time}`;

  if (days.length === 1) return `${DAY_NAMES[days[0]]} ${time}`;

  const sorted = [...days].sort((a, b) => a - b);
  return `${sorted.map((d) => DAY_SHORT[d]).join(', ')} ${time}`;
}

/**
 * Időpontot olvasható alakra hoz: a mai/tegnapi/holnapi napot szóval jelöli, távolabbit
 * dátummal. A `now` paraméterezhető, hogy a megjelenítés tesztelhető/determinisztikus legyen.
 */
export function formatRunTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (dayDiff === 0) return `Ma ${time}`;
  if (dayDiff === -1) return `Tegnap ${time}`;
  if (dayDiff === 1) return `Holnap ${time}`;

  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}. ${time}`;
}

function outcomeLabel(run: TaskRun): string {
  switch (run.outcome) {
    case 'success':
      return 'sikeres';
    case 'failed':
      return 'sikertelen';
    case 'skipped':
      return 'kihagyott';
  }
}

export function TaskCard({ task, onRunNow, onToggleEnabled, onEdit, onDelete }: Props) {
  const { lastRun } = task;

  return (
    <div className={`task-card${task.enabled ? '' : ' task-card--paused'}`}>
      <div className="task-card__header">
        <span className="task-card__name">{task.name}</span>
        <span
          className={`task-badge${task.enabled ? ' task-badge--active' : ' task-badge--paused'}`}
        >
          {task.enabled ? 'Aktív' : 'Szüneteltetve'}
        </span>
      </div>

      <div className="task-card__schedule">{formatSchedule(task.schedule)}</div>

      <p className="task-card__prompt">{task.prompt}</p>

      <div className="task-card__meta">
        <span className="task-card__meta-item">
          <span className="task-card__meta-label">Utoljára</span>
          {lastRun ? (
            <>
              <span className="task-card__meta-value">{formatRunTime(lastRun.at)}</span>
              <span className={`task-outcome task-outcome--${lastRun.outcome}`}>
                {outcomeLabel(lastRun)}
              </span>
            </>
          ) : (
            <span className="task-card__meta-value task-card__meta-value--muted">
              még nem futott
            </span>
          )}
        </span>

        <span className="task-card__meta-item">
          <span className="task-card__meta-label">Következő</span>
          {task.enabled && task.nextRunAt ? (
            <span className="task-card__meta-value">{formatRunTime(task.nextRunAt)}</span>
          ) : (
            <span className="task-card__meta-value task-card__meta-value--muted">—</span>
          )}
        </span>
      </div>

      {lastRun?.error && <div className="task-card__error">{lastRun.error}</div>}

      <div className="task-card__actions">
        <button type="button" className="task-action" onClick={() => onRunNow(task.id)}>
          Futtatás most
        </button>
        <button type="button" className="task-action" onClick={() => onToggleEnabled(task.id)}>
          {task.enabled ? 'Szüneteltetés' : 'Aktiválás'}
        </button>
        <span className="task-card__actions-spacer" />
        <button
          type="button"
          className="task-action task-action--icon"
          onClick={() => onEdit(task.id)}
          aria-label={`${task.name} szerkesztése`}
        >
          ✎
        </button>
        <button
          type="button"
          className="task-action task-action--icon task-action--danger"
          onClick={() => onDelete(task.id)}
          aria-label={`${task.name} törlése`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
