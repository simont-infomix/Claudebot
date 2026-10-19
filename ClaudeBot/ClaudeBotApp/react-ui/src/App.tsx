import { useEffect, useState } from 'react';
import { bridge } from './bridge/BridgeClient';
import type { Bot, LogLine } from './types';
import { Sidebar } from './components/Sidebar';
import { LogView } from './components/LogView';
import { NewBotDialog } from './components/NewBotDialog';
import './App.css';

export default function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

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
        case 'error':
          setDialogError(event.message);
          break;
      }
    });

    return unsubscribe;
  }, [selectedBotId]);

  function handleSelectBot(botId: string) {
    setSelectedBotId(botId);
    setLogs([]);
    bridge.selectBot(botId);
  }

  function handleCreateBot(name: string) {
    setDialogError(null);
    bridge.createBot(name);
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
      />
      <LogView
        bot={selectedBot}
        logs={logs}
        onOpenTerminal={() => selectedBot && bridge.openTerminal(selectedBot.id)}
      />
      {dialogOpen && (
        <NewBotDialog
          error={dialogError}
          onSubmit={handleCreateBot}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
