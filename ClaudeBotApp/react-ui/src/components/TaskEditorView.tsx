import { useEffect, useState } from 'react';
import type { ScheduledTask, TaskSchedule, TaskScheduleType } from '../types';
import { Select } from './Select';
import './TaskEditorView.css';

interface Props {
  open: boolean;
  /** null = új feladat létrehozása; kitöltve = meglévő szerkesztése (UC-011). */
  task: ScheduledTask | null;
  onClose: () => void;
  onSubmit: (task: ScheduledTask) => void;
}

const SCHEDULE_TYPE_OPTIONS = [
  { label: 'Naponta többször', value: 'interval' },
  { label: 'Hetente', value: 'weekly' },
  { label: 'Havonta', value: 'monthly' },
];

/** A hét összes napja — a "minden nap" kapcsoló ezt a halmazt állítja be. */
const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** A hónap napjai 1–31-ig — szándékosan mindig a teljes skála látszik, hónaphossztól függetlenül. */
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Ezek a napok hiányozhatnak egy rövidebb hónapból, ezért kapnak külön magyarázatot. */
const SHORT_MONTH_DAYS = [29, 30, 31];

/** Hétfővel kezdődő sorrend — a magyar naptári konvenció szerint. */
const WEEK_DAYS = [
  { value: 1, label: 'H' },
  { value: 2, label: 'K' },
  { value: 3, label: 'Sze' },
  { value: 4, label: 'Cs' },
  { value: 5, label: 'P' },
  { value: 6, label: 'Szo' },
  { value: 0, label: 'V' },
];

interface FormState {
  name: string;
  prompt: string;
  scheduleType: TaskScheduleType;
  /** Két futás között eltelő idő óra-része (nem időpont). */
  intervalHours: string;
  /** Két futás között eltelő idő perc-része. */
  intervalMinutes: string;
  timeOfDay: string;
  daysOfWeek: number[];
  daysOfMonth: number[];
}

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  scheduleType: 'weekly',
  intervalHours: '2',
  intervalMinutes: '0',
  timeOfDay: '08:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  daysOfMonth: [1],
};

function formFromTask(task: ScheduledTask | null): FormState {
  if (!task) return EMPTY_FORM;

  const totalMinutes = task.schedule.intervalMinutes ?? 120;

  return {
    name: task.name,
    prompt: task.prompt,
    scheduleType: task.schedule.type,
    intervalHours: String(Math.floor(totalMinutes / 60)),
    intervalMinutes: String(totalMinutes % 60),
    timeOfDay: task.schedule.timeOfDay ?? '08:00',
    daysOfWeek: task.schedule.daysOfWeek ?? [1, 2, 3, 4, 5],
    daysOfMonth: task.schedule.daysOfMonth ?? [1],
  };
}

export function TaskEditorView({ open, task, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(() => formFromTask(task));

  // A panel megnyitásakor töltjük fel az űrlapot, hogy egy félkész szerkesztés ne íródjon
  // felül, amíg a panel nyitva van.
  useEffect(() => {
    if (open) setForm(formFromTask(task));
  }, [open, task]);

  function update(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day],
    }));
  }

  function toggleDayOfMonth(day: number) {
    setForm((prev) => ({
      ...prev,
      daysOfMonth: prev.daysOfMonth.includes(day)
        ? prev.daysOfMonth.filter((d) => d !== day)
        : [...prev.daysOfMonth, day],
    }));
  }

  /** "Minden nap" = mind a hét nap ki van jelölve; a kapcsoló állása ebből származtatott. */
  const isEveryDay = ALL_WEEK_DAYS.every((d) => form.daysOfWeek.includes(d));

  function toggleEveryDay() {
    update({ daysOfWeek: isEveryDay ? [] : [...ALL_WEEK_DAYS] });
  }

  const hasShortMonthDay = form.daysOfMonth.some((d) => SHORT_MONTH_DAYS.includes(d));

  const intervalTotalMinutes =
    (parseInt(form.intervalHours, 10) || 0) * 60 + (parseInt(form.intervalMinutes, 10) || 0);

  /** Az első olyan hiányosság, ami miatt a feladat nem menthető — vagy null, ha minden rendben. */
  function validationError(): string | null {
    if (!form.name.trim()) return 'Adj nevet a feladatnak.';
    if (!form.prompt.trim()) return 'Add meg, mit csináljon a bot a feladat futásakor.';

    if (form.scheduleType === 'interval' && intervalTotalMinutes <= 0)
      return 'Két futás között legalább egy percnek el kell telnie.';

    if (form.scheduleType === 'weekly' && form.daysOfWeek.length === 0)
      return 'Jelölj ki legalább egy napot.';

    if (form.scheduleType === 'monthly' && form.daysOfMonth.length === 0)
      return 'Jelölj ki legalább egy napot a hónapban.';

    return null;
  }

  const error = validationError();

  function buildSchedule(): TaskSchedule {
    if (form.scheduleType === 'interval') {
      return { type: 'interval', intervalMinutes: intervalTotalMinutes };
    }

    if (form.scheduleType === 'monthly') {
      return {
        type: 'monthly',
        timeOfDay: form.timeOfDay,
        daysOfMonth: [...form.daysOfMonth].sort((a, b) => a - b),
      };
    }

    return {
      type: 'weekly',
      timeOfDay: form.timeOfDay,
      daysOfWeek: [...form.daysOfWeek].sort((a, b) => a - b),
    };
  }

  function handleSubmit() {
    if (error) return;

    onSubmit({
      // Szerkesztésnél megtartjuk az azonosítót és a futási előzményt — a hoszt ezek alapján
      // fésüli össze a definíciót a futásidejű állapottal.
      id: task?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      schedule: buildSchedule(),
      enabled: task?.enabled ?? true,
      lastRun: task?.lastRun ?? null,
      nextRunAt: task?.nextRunAt ?? null,
    });
  }

  return (
    <div className={`task-editor${open ? ' task-editor--open' : ''}`}>
      <div className="task-editor__header">
        <span className="task-editor__title">{task ? 'Feladat szerkesztése' : 'Új feladat'}</span>
        <span className="task-editor__header-spacer" />
        <button
          type="button"
          className="task-editor__close"
          onClick={onClose}
          aria-label="Bezárás"
        >
          ×
        </button>
      </div>

      <div className="task-editor__body">
        <div className="task-editor__form">
          <label className="task-field">
            <span className="task-field__label">Feladat neve</span>
            <input
              className="task-field__input"
              placeholder="pl. Reggeli levél-triázs"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>

          <label className="task-field">
            <span className="task-field__label">Prompt</span>
            <span className="task-field__hint">
              Ezt a szöveget kapja meg a bot minden egyes futáskor.
            </span>
            <textarea
              className="task-field__textarea"
              placeholder="Mit csináljon a bot, amikor ez a feladat lefut?"
              value={form.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
            />
          </label>

          <div className="task-schedule">
            <span className="task-field__label">Ütemezés</span>

            <div className="task-schedule__row">
              <span className="task-schedule__row-label">Ismétlődés</span>
              <Select
                ariaLabel="Ismétlődés típusa"
                value={form.scheduleType}
                onChange={(v) => update({ scheduleType: v as TaskScheduleType })}
                options={SCHEDULE_TYPE_OPTIONS}
              />
            </div>

            {form.scheduleType === 'interval' && (
              <div className="task-schedule__row">
                <span className="task-schedule__row-label">Két futás között</span>
                <div className="task-schedule__inline">
                  <input
                    className="task-field__input task-field__input--tiny"
                    type="number"
                    min={0}
                    value={form.intervalHours}
                    onChange={(e) => update({ intervalHours: e.target.value })}
                    aria-label="Óra"
                  />
                  <span className="task-schedule__unit">óra</span>
                  <input
                    className="task-field__input task-field__input--tiny"
                    type="number"
                    min={0}
                    max={59}
                    value={form.intervalMinutes}
                    onChange={(e) => update({ intervalMinutes: e.target.value })}
                    aria-label="Perc"
                  />
                  <span className="task-schedule__unit">perc</span>
                </div>
              </div>
            )}

            {form.scheduleType !== 'interval' && (
              <div className="task-schedule__row">
                <span className="task-schedule__row-label">Időpont</span>
                <input
                  className="task-field__input task-field__input--narrow"
                  type="time"
                  value={form.timeOfDay}
                  onChange={(e) => update({ timeOfDay: e.target.value })}
                />
              </div>
            )}

            {form.scheduleType === 'weekly' && (
              <>
                <div className="task-schedule__row task-schedule__row--days">
                  <span className="task-schedule__row-label">Napok</span>
                  <div className="task-days">
                    {WEEK_DAYS.map((d) => {
                      const isOn = form.daysOfWeek.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          className={`task-day${isOn ? ' task-day--on' : ''}`}
                          onClick={() => toggleDay(d.value)}
                          aria-pressed={isOn}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="task-check">
                  <input
                    type="checkbox"
                    className="task-check__input"
                    checked={isEveryDay}
                    onChange={toggleEveryDay}
                  />
                  <span className="task-check__label">Minden nap</span>
                </label>
              </>
            )}

            {form.scheduleType === 'monthly' && (
              <div className="task-schedule__block">
                <span className="task-schedule__row-label">A hónap napjai</span>
                <div className="task-month-grid">
                  {MONTH_DAYS.map((day) => {
                    const isOn = form.daysOfMonth.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`task-month-day${isOn ? ' task-month-day--on' : ''}`}
                        onClick={() => toggleDayOfMonth(day)}
                        aria-pressed={isOn}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                {hasShortMonthDay && (
                  <p className="task-schedule__note">
                    A 29., 30. és 31. napra ütemezett futások azokban a hónapokban, ahol nincs
                    ilyen nap, a hónap utolsó napján indulnak el — így egyetlen hónap sem marad ki.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="task-editor__footer">
        {error && <span className="task-editor__validation">{error}</span>}
        <span className="task-editor__footer-spacer" />
        <button type="button" className="task-editor__cancel" onClick={onClose}>
          Mégse
        </button>
        <button
          type="button"
          className="task-editor__submit"
          onClick={handleSubmit}
          disabled={error !== null}
        >
          {task ? 'Mentés' : 'Létrehozás'}
        </button>
      </div>
    </div>
  );
}
