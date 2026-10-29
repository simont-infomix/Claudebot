import type { Bot, ScheduledTask } from '../types';
import { TaskCard } from './TaskCard';
import './TasksView.css';
import './SettingsView.css';

interface Props {
  bot: Bot | null;
  error: string | null;
  /** A teljes feladatlistát menti — minden művelet azonnal perzisztál, nincs külön Mentés gomb. */
  onSave: (scheduledTasks: ScheduledTask[]) => void;
  onRunNow: (taskId: string) => void;
  onOpenEditor: (task: ScheduledTask | null) => void;
}

export function TasksView({ bot, error, onSave, onRunNow, onOpenEditor }: Props) {
  if (!bot) return null;

  const tasks = bot.scheduledTasks;

  function toggleEnabled(id: string) {
    onSave(tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
  }

  function deleteTask(id: string) {
    onSave(tasks.filter((t) => t.id !== id));
  }

  return (
    <div className="tasks-view">
      {error && <div className="tasks-view__error">{error}</div>}

      <div className="tasks-view__body">
        <div className="tasks-panel">
          <div className="tasks-panel__header">
            <span className="settings-tools__title">Ütemezett feladatok</span>
            <span className="info-icon" tabIndex={0}>
              ⓘ
              <span className="info-icon__tooltip">
                A feladatok akkor futnak le maguktól, ha az alkalmazás fut. A kimenetük a bot
                csevegésében olvasható.
              </span>
            </span>
            <span className="tasks-panel__header-spacer" />
            <button
              type="button"
              className="tasks-panel__add"
              onClick={() => onOpenEditor(null)}
            >
              + Új feladat
            </button>
          </div>

          {tasks.length === 0 ? (
            <span className="settings-empty-note">Nincs még ütemezett feladat.</span>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onRunNow={onRunNow}
                  onEdit={() => onOpenEditor(task)}
                  onToggleEnabled={toggleEnabled}
                  onDelete={deleteTask}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
