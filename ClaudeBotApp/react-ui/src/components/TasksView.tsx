import { useEffect, useState } from 'react';
import type { Bot, ScheduledTask } from '../types';
import './TasksView.css';
import './SettingsView.css';

interface Props {
  bot: Bot | null;
  error: string | null;
  onSave: (scheduledTasks: ScheduledTask[]) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function TasksView({ bot, error, onSave, onDirtyChange }: Props) {
  const [draftTasks, setDraftTasks] = useState<ScheduledTask[]>(bot?.scheduledTasks ?? []);
  const [newTask, setNewTask] = useState({ name: '', schedule: '', prompt: '' });

  // Csak bot-váltáskor töltjük újra a draftot, hogy egy élő botList-frissítés ne írja felül a
  // félkész, még nem mentett szerkesztést (ugyanaz a minta, mint a SettingsView-ban).
  useEffect(() => {
    setDraftTasks(bot?.scheduledTasks ?? []);
    setNewTask({ name: '', schedule: '', prompt: '' });
  }, [bot?.id]);

  const isDirty = bot ? JSON.stringify(draftTasks) !== JSON.stringify(bot.scheduledTasks) : false;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  if (!bot) return null;

  function addScheduledTask() {
    const name = newTask.name.trim();
    if (!name) return;
    const task: ScheduledTask = {
      id: crypto.randomUUID(),
      name,
      schedule: newTask.schedule.trim(),
      prompt: newTask.prompt.trim(),
    };
    setDraftTasks((prev) => [...prev, task]);
    setNewTask({ name: '', schedule: '', prompt: '' });
  }

  function removeScheduledTask(id: string) {
    setDraftTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="tasks-view">
      {isDirty && (
        <button type="button" className="tasks-view__save" onClick={() => onSave(draftTasks)}>
          Mentés
        </button>
      )}

      {error && <div className="tasks-view__error">{error}</div>}

      <div className="tasks-view__body">
        <div className="settings-tasks">
          <div className="settings-tools__header">
            <span className="settings-tools__title">Ütemezett feladatok</span>
            <span className="info-icon" tabIndex={0}>
              ⓘ
              <span className="info-icon__tooltip">
                Ez egyelőre csak a feladat-definíciók tárolása — az automatikus, ütemezés szerinti
                futtatás (scheduler) még nincs megvalósítva.
              </span>
            </span>
          </div>

          {draftTasks.length === 0 ? (
            <span className="settings-empty-note">Nincs még ütemezett feladat.</span>
          ) : (
            <div className="task-list">
              {draftTasks.map((task) => (
                <div key={task.id} className="task-card">
                  <div className="task-card__header">
                    <span className="task-card__name">{task.name}</span>
                    <button
                      type="button"
                      className="task-card__remove"
                      onClick={() => removeScheduledTask(task.id)}
                      aria-label={`${task.name} törlése`}
                    >
                      ×
                    </button>
                  </div>
                  {task.schedule && <div className="task-card__schedule">{task.schedule}</div>}
                  {task.prompt && <div className="task-card__prompt">{task.prompt}</div>}
                </div>
              ))}
            </div>
          )}

          <div className="task-form">
            <input
              className="task-form__input"
              placeholder="Feladat neve"
              value={newTask.name}
              onChange={(e) => setNewTask((t) => ({ ...t, name: e.target.value }))}
            />
            <input
              className="task-form__input"
              placeholder="Ütemezés (pl. minden hétköznap 8:00)"
              value={newTask.schedule}
              onChange={(e) => setNewTask((t) => ({ ...t, schedule: e.target.value }))}
            />
            <textarea
              className="task-form__textarea"
              placeholder="Prompt, amit a feladat elindulásakor kapjon az agent"
              value={newTask.prompt}
              onChange={(e) => setNewTask((t) => ({ ...t, prompt: e.target.value }))}
            />
            <button type="button" className="task-form__add" onClick={addScheduledTask}>
              Feladat hozzáadása
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
