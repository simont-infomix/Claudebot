import { useEffect, useState } from 'react';
import { bridge } from './bridge/BridgeClient';
import type {
  Bot,
  BotDetails,
  BotSettingsDraft,
  EncodedAttachment,
  LogLine,
  MainTab,
  ScheduledTask,
  SettingsTab,
} from './types';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { TasksView } from './components/TasksView';
import { SettingsView } from './components/SettingsView';
import { NewBotDialog } from './components/NewBotDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import './App.css';

export default function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('chat');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [tasksDirty, setTasksDirty] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [botDetails, setBotDetails] = useState<BotDetails | null>(null);

  // A hosztnak (WinForms) a Settings lap ÉS a Feladatok nézet mentetlen módosítását is együtt
  // kell jeleznünk — bármelyik dirty, alkalmazás-bezáráskor rá kell kérdezni.
  useEffect(() => {
    bridge.setSettingsDirty(settingsDirty || tasksDirty);
  }, [settingsDirty, tasksDirty]);

  useEffect(() => {
    bridge.getBots();
  }, []);

  useEffect(() => {
    const unsubscribe = bridge.on((event) => {
      switch (event.type) {
        case 'botList': {
          setBots(event.bots);
          setDialogOpen(false);
          setSelectedBotId((current) => current ?? event.bots[0]?.id ?? null);
          break;
        }
        case 'botLog':
          if (event.botId === selectedBotId) {
            setLogs(event.lines);
          }
          break;
        case 'logAppended':
          if (event.botId === selectedBotId) {
            setLogs((prev) => [...prev, event.line]);
          }
          break;
        case 'botStatusChanged':
          setBots((prev) =>
            prev.map((b) => (b.id === event.botId ? { ...b, status: event.status } : b)),
          );
          break;
        case 'botRenamed':
          setSelectedBotId((current) => (current === event.oldId ? event.newId : current));
          break;
        case 'confirmExit':
          setExitConfirmOpen(true);
          break;
        case 'botDetails':
          if (event.botId === selectedBotId) {
            setBotDetails({
              agentDefinition: event.agentDefinition,
              skills: event.skills,
              subAgents: event.subAgents,
            });
          }
          break;
        case 'error':
          setDialogError(event.message);
          setSettingsError(event.message);
          setTasksError(event.message);
          break;
      }
    });

    return unsubscribe;
  }, [selectedBotId]);

  function handleSelectBot(botId: string) {
    setSelectedBotId(botId);
    setLogs([]);
    setSettingsOpen(false);
    setSettingsError(null);
    setTasksError(null);
    setBotDetails(null);
    bridge.selectBot(botId);
  }

  function handleOpenSettings(botId: string, tab: SettingsTab) {
    handleSelectBot(botId);
    setSettingsTab(tab);
    setSettingsOpen(true);
    bridge.getBotDetails(botId);
  }

  // A jobbklikk-menü "Feladatok" gyorslinkje és a fő tab-sáv "Feladatok" tabja ugyanide vezet —
  // ez immár nem a Settings lap egyik füle, hanem a fő tartalomterület önálló nézete.
  function handleOpenTasks(botId: string) {
    handleSelectBot(botId);
    setMainTab('tasks');
  }

  // A fő tab-sáv jobb szélén lévő fogaskerék-ikon nyitja meg a Settings lapot a JELENLEG
  // kiválasztott bothoz — nem vált botot, ezért nem hívja handleSelectBot-ot (az törölné a
  // chat-logot és egy felesleges selectBot-kört indítana).
  function handleOpenSettingsForSelected() {
    if (!selectedBotId) return;
    setSettingsTab('settings');
    setSettingsOpen(true);
    bridge.getBotDetails(selectedBotId);
  }

  function handleSaveTasks(scheduledTasks: ScheduledTask[]) {
    if (!selectedBot) return;
    setTasksError(null);
    bridge.saveSettings(selectedBot.id, {
      name: selectedBot.name,
      allowedTools: selectedBot.allowedTools,
      model: selectedBot.model,
      effort: selectedBot.effort,
      permissionMode: selectedBot.permissionMode,
      scheduledTasks,
    });
  }

  function handleCreateBot(name: string) {
    setDialogError(null);
    bridge.createBot(name);
  }

  function handleSendPrompt(text: string, attachments: EncodedAttachment[]) {
    if (!selectedBotId) return;
    const attachmentNote =
      attachments.length > 0 ? `📎 ${attachments.map((a) => a.name).join(', ')}` : '';
    const displayText = [text, attachmentNote].filter(Boolean).join('\n\n');
    setLogs((prev) => [...prev, { kind: 'user', text: displayText }]);
    bridge.sendPrompt(selectedBotId, text, attachments);
  }

  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null;

  return (
    <div className="app">
      <Sidebar
        bots={bots}
        selectedBotId={selectedBotId}
        onSelect={handleSelectBot}
        onAddClick={() => {
          setDialogError(null);
          setDialogOpen(true);
        }}
        onOpenSettings={handleOpenSettings}
        onOpenTasks={handleOpenTasks}
        onOpenWorkspaceFolder={(botId) => bridge.openWorkspaceFolder(botId)}
        onOpenTerminal={(botId) => bridge.openTerminal(botId)}
        onRestart={(botId) => bridge.restartBot(botId)}
      />
      <div className="content-slot">
        <div className="main-tabs">
          <button
            type="button"
            className={`main-tab${mainTab === 'chat' ? ' main-tab--active' : ''}`}
            onClick={() => setMainTab('chat')}
          >
            Csevegés
          </button>
          <button
            type="button"
            className={`main-tab${mainTab === 'tasks' ? ' main-tab--active' : ''}`}
            onClick={() => setMainTab('tasks')}
          >
            Feladatok
          </button>
          <span className="main-tabs__spacer" />
          <button
            type="button"
            className="main-tabs__settings"
            onClick={handleOpenSettingsForSelected}
            aria-label="Beállítások"
          >
            ⚙
          </button>
        </div>
        <div className="content-area">
          {mainTab === 'chat' && (
            <ChatView bot={selectedBot} logs={logs} onSendPrompt={handleSendPrompt} />
          )}
          {mainTab === 'tasks' && (
            <TasksView
              bot={selectedBot}
              error={tasksError}
              onDirtyChange={setTasksDirty}
              onSave={handleSaveTasks}
            />
          )}
        </div>
        <SettingsView
          bot={selectedBot}
          open={settingsOpen}
          activeTab={settingsTab}
          onTabChange={setSettingsTab}
          details={botDetails}
          error={settingsError}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsError(null);
          }}
          onSetAvatar={(contentType, dataBase64) =>
            selectedBot && bridge.setBotAvatar(selectedBot.id, contentType, dataBase64)
          }
          onDirtyChange={setSettingsDirty}
          onSave={(settings: BotSettingsDraft) => {
            setSettingsError(null);
            selectedBot && bridge.saveSettings(selectedBot.id, settings);
          }}
        />
      </div>
      {dialogOpen && (
        <NewBotDialog
          error={dialogError}
          onSubmit={handleCreateBot}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {exitConfirmOpen && (
        <ConfirmDialog
          title="Alkalmazás bezárása"
          message="Egy bot Settings lapján vagy a Feladatok nézetében mentetlen módosítások vannak. Biztosan bezárod az alkalmazást mentés nélkül?"
          onCancel={() => {
            setExitConfirmOpen(false);
            bridge.respondToExitConfirm(false);
          }}
          onConfirm={() => {
            setExitConfirmOpen(false);
            bridge.respondToExitConfirm(true);
          }}
        />
      )}
    </div>
  );
}
