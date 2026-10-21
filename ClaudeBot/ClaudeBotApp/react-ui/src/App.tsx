import { useEffect, useState } from 'react';
import { bridge } from './bridge/BridgeClient';
import type { Bot, BotDetails, BotSettingsDraft, EncodedAttachment, LogLine, SettingsTab } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { SettingsView } from './components/SettingsView';
import { NewBotDialog } from './components/NewBotDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import './App.css';

export default function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [botDetails, setBotDetails] = useState<BotDetails | null>(null);

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
    setBotDetails(null);
    bridge.selectBot(botId);
  }

  function handleOpenSettings(botId: string, tab: SettingsTab) {
    handleSelectBot(botId);
    setSettingsTab(tab);
    setSettingsOpen(true);
    bridge.getBotDetails(botId);
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
        onOpenWorkspaceFolder={(botId) => bridge.openWorkspaceFolder(botId)}
        onOpenTerminal={(botId) => bridge.openTerminal(botId)}
        onRestart={(botId) => bridge.restartBot(botId)}
      />
      <div className="content-slot">
        <ChatView bot={selectedBot} logs={logs} onSendPrompt={handleSendPrompt} />
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
          onDirtyChange={(dirty) => bridge.setSettingsDirty(dirty)}
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
          message="Egy bot Settings lapján mentetlen módosítások vannak. Biztosan bezárod az alkalmazást mentés nélkül?"
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
