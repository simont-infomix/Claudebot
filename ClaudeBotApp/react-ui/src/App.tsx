import { useEffect, useState } from 'react';
import { bridge } from './bridge/BridgeClient';
import type {
  Bot,
  BotDetails,
  BotSettingsDraft,
  EncodedAttachment,
  LogLine,
  MainTab,
  PermissionAnswer,
  PermissionDecision,
  PermissionRequest,
  ScheduledTask,
  SettingsTab,
} from './types';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { TasksView } from './components/TasksView';
import { TaskEditorView } from './components/TaskEditorView';
import { SettingsView } from './components/SettingsView';
import { NewBotDialog } from './components/NewBotDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DeleteBotDialog } from './components/DeleteBotDialog';
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
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  /** Mentetlen Settings-piszkozat miatt megerősítésre váró navigáció (botváltás, és ami vele jár).
   *  Amíg nem null, a megerősítő dialógus látszik; a végrehajtása a felhasználó döntésén múlik. */
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [botDetails, setBotDetails] = useState<BotDetails | null>(null);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [taskBeingEdited, setTaskBeingEdited] = useState<ScheduledTask | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  /** Törlésre küldött bot azonosítója — amíg él, a Settings lap nyitva marad, hogy egy
   *  esetleges hibaüzenet látható legyen. Az értéket csak a funkcionális frissítőkön belül
   *  olvassuk (a botList esemény kezelésekor), ezért itt nem kötjük le. */
  const [, setPendingDeleteBotId] = useState<string | null>(null);

  /** Jóváhagyási kérések botId → requestId szerint (UC-018). Azért bot szerint csoportosítva,
   *  mert egy másik bot kérése sem veszhet el amiatt, hogy épp nem azt nézzük. */
  const [permissions, setPermissions] = useState<
    Record<string, Record<string, { request: PermissionRequest; decision: PermissionDecision }>>
  >({});

  // A hosztnak (WinForms) jelezzük a mentetlen módosítást, hogy alkalmazás-bezáráskor rá
  // tudjon kérdezni. Csak a Settings lapnak van piszkozat-állapota — a Feladatok nézet minden
  // műveletet azonnal ment, ott nem keletkezhet mentetlen változás.
  useEffect(() => {
    bridge.setSettingsDirty(settingsDirty);
  }, [settingsDirty]);

  useEffect(() => {
    bridge.getBots();
  }, []);

  // A hosztnak jelezzük, melyik bot csevegése van ténylegesen a képernyőn — ebből (az ablak
  // láthatóságával együtt, amit a C# oldal követ) dönti el, hogy egy új bot-üzenet "látottnak"
  // számít-e (UC-017). A Settings lap és a feladat-szerkesztő a teljes tartalomterületet
  // lefedi, ezért amíg azok nyitva vannak, nincs aktívan megtekintett csevegés.
  useEffect(() => {
    const viewedBotId = !settingsOpen && !taskEditorOpen && mainTab === 'chat' ? selectedBotId : null;
    bridge.setViewedBot(viewedBotId);
  }, [selectedBotId, mainTab, settingsOpen, taskEditorOpen]);

  useEffect(() => {
    const unsubscribe = bridge.on((event) => {
      switch (event.type) {
        case 'botList': {
          setBots(event.bots);
          setDialogOpen(false);

          // Ha a törlésre küldött bot eltűnt a listából, a törlés sikerült: ekkor zárjuk a
          // Settings lapot. (Hiba esetén a bot a listában marad, a lap nyitva, és ott látszik
          // a hibaüzenet.)
          setPendingDeleteBotId((pending) => {
            if (pending != null && !event.bots.some((b) => b.id === pending)) {
              setSettingsOpen(false);
              setSettingsDirty(false);
              return null;
            }
            return pending;
          });
          // Ha a kijelölt bot eltűnt a listából (pl. törölték), a kijelölés nem maradhat rajta —
          // különben egy már nem létező botra mutatnának a nézetek.
          setSelectedBotId((current) =>
            current != null && event.bots.some((b) => b.id === current)
              ? current
              : event.bots[0]?.id ?? null,
          );
          break;
        }
        case 'botLog':
          if (event.botId === selectedBotId) {
            setLogs(event.lines);
          }
          // A függő kérések a bot kiválasztásától FÜGGETLENÜL frissülnek: ez az autoritatív
          // pillanatkép az adott botról.
          setPermissions((prev) => ({
            ...prev,
            [event.botId]: Object.fromEntries(
              event.pendingPermissions.map((r) => [r.requestId, { request: r, decision: 'pending' as const }]),
            ),
          }));
          break;
        case 'logAppended':
          if (event.botId === selectedBotId) {
            setLogs((prev) => [...prev, event.line]);
          }
          break;
        // A két permission-ág szándékosan NINCS a kiválasztott bothoz kötve: egy másik bot
        // kérése is válaszra vár, és a kártyájának ott kell lennie, amikor rá váltunk.
        case 'permissionRequest':
          setPermissions((prev) => ({
            ...prev,
            [event.botId]: {
              ...prev[event.botId],
              [event.request.requestId]: { request: event.request, decision: 'pending' },
            },
          }));
          break;
        case 'permissionResolved':
          setPermissions((prev) => {
            const forBot = prev[event.botId];
            const entry = forBot?.[event.requestId];
            if (!entry) return prev;

            // A lezárt kérést nem töröljük: a kártya a beszélgetésben marad, a döntéssel együtt.
            return {
              ...prev,
              [event.botId]: { ...forBot, [event.requestId]: { ...entry, decision: event.decision } },
            };
          });
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
          // A törlés meghiúsult — a bot megmarad, a Settings lap nyitva marad a hibaüzenettel.
          setPendingDeleteBotId(null);
          break;
      }
    });

    return unsubscribe;
  }, [selectedBotId]);

  /** A tényleges botváltás, ellenőrzés nélkül. Csak a `guardUnsavedSettings`-en keresztül
   *  hívandó, különben egy mentetlen Settings-piszkozat némán elveszne. */
  function selectBotNow(botId: string) {
    setSelectedBotId(botId);
    setLogs([]);
    setSettingsOpen(false);
    setSettingsError(null);
    setTasksError(null);
    setBotDetails(null);
    // A feladat-szerkesztő a korábbi bot egyik feladatára vonatkozik, ezért botváltáskor zárjuk.
    setTaskEditorOpen(false);
    bridge.selectBot(botId);
  }

  /**
   * Botváltás előtt megerősítést kér, ha a Settings lapon mentetlen módosítás van — a váltás
   * ugyanis bezárja a lapot, és a piszkozat elveszne. Ugyanaz a védelem, mint a Settings lap ×
   * gombjánál és az alkalmazás bezárásánál, csak itt a navigáció a kiváltó esemény.
   *
   * A szándékot (nem csak a cél-botot) függvényként tároljuk, mert a hívók nem egyformák: van,
   * amelyik a váltás után megnyitja a Settings lapot vagy a Feladatok nézetet is.
   */
  function guardUnsavedSettings(action: () => void) {
    if (settingsDirty) {
      setPendingNavigation(() => action);
      return;
    }

    action();
  }

  function handleSelectBot(botId: string) {
    guardUnsavedSettings(() => selectBotNow(botId));
  }

  function handleOpenSettings(botId: string, tab: SettingsTab) {
    guardUnsavedSettings(() => {
      selectBotNow(botId);
      setSettingsTab(tab);
      setSettingsOpen(true);
      bridge.getBotDetails(botId);
    });
  }

  // A jobbklikk-menü "Feladatok" gyorslinkje és a fő tab-sáv "Feladatok" tabja ugyanide vezet —
  // ez immár nem a Settings lap egyik füle, hanem a fő tartalomterület önálló nézete.
  function handleOpenTasks(botId: string) {
    guardUnsavedSettings(() => {
      selectBotNow(botId);
      setMainTab('tasks');
    });
  }

  // A fő tab-sáv jobb szélén lévő fogaskerék-ikon nyitja meg a Settings lapot a JELENLEG
  // kiválasztott bothoz — nem vált botot, ezért nem hívja handleSelectBot-ot (az törölné a
  // chat-logot és egy felesleges selectBot-kört indítana).
  function handleOpenSettingsForSelected() {
    if (!selectedBotId) return;
    setTaskEditorOpen(false);
    setSettingsTab('settings');
    setSettingsOpen(true);
    bridge.getBotDetails(selectedBotId);
  }

  /** Feladat-mentés: a beállítás-mezőket a bot MENTETT állapotából vesszük, nem a Settings lap
   *  esetleg félkész piszkozatából. */
  function handleSaveTasks(scheduledTasks: ScheduledTask[]) {
    if (!selectedBot) return;
    setTasksError(null);
    bridge.saveSettings(
      selectedBot.id,
      {
        name: selectedBot.name,
        allowedTools: selectedBot.allowedTools,
        model: selectedBot.model,
        effort: selectedBot.effort,
        permissionMode: selectedBot.permissionMode,
        interactiveApproval: selectedBot.interactiveApproval,
        channelEnabled: selectedBot.channelEnabled,
      },
      scheduledTasks,
    );
  }

  /** Új feladat felvétele vagy meglévő felülírása — mindkettő a teljes lista mentése. */
  function handleSubmitTask(task: ScheduledTask) {
    if (!selectedBot) return;
    const existing = selectedBot.scheduledTasks;
    const isEdit = existing.some((t) => t.id === task.id);
    handleSaveTasks(isEdit ? existing.map((t) => (t.id === task.id ? task : t)) : [...existing, task]);
  }

  function handleCreateBot(name: string) {
    setDialogError(null);
    bridge.createBot(name);
  }

  function handleOpenLink(target: string) {
    if (!selectedBotId) return;
    bridge.openLink(selectedBotId, target);
  }

  function handleSendPrompt(text: string, attachments: EncodedAttachment[]) {
    if (!selectedBotId) return;
    // A fájlnevek backtickben: így a csatolás-jelzésben is kattintható hivatkozás lesz belőlük
    // (ld. MessageText). Ugyanezt a formát állítja elő a host oldali BotSession.SendPrompt is,
    // hogy bot-váltás után, a mentett előzményből visszatöltve is ugyanígy nézzen ki.
    const attachmentNote =
      attachments.length > 0 ? `📎 ${attachments.map((a) => `\`${a.name}\``).join(', ')}` : '';
    const displayText = [text, attachmentNote].filter(Boolean).join('\n\n');
    setLogs((prev) => [...prev, { kind: 'user', text: displayText }]);
    bridge.sendPrompt(selectedBotId, text, attachments);
  }

  function handleRespondPermission(requestId: string, answer: PermissionAnswer) {
    if (!selectedBotId) return;
    bridge.respondToPermission(selectedBotId, requestId, answer);
  }

  function handleAnswerQuestion(requestId: string, answers: Record<string, string | string[]>) {
    if (!selectedBotId) return;
    bridge.answerUserQuestion(selectedBotId, requestId, answers);
  }

  function handleSkipQuestion(requestId: string) {
    if (!selectedBotId) return;
    bridge.skipUserQuestion(selectedBotId, requestId);
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
            <ChatView
              bot={selectedBot}
              logs={logs}
              permissions={selectedBotId ? permissions[selectedBotId] ?? {} : {}}
              onRespondPermission={handleRespondPermission}
              onAnswerQuestion={handleAnswerQuestion}
              onSkipQuestion={handleSkipQuestion}
              onSendPrompt={handleSendPrompt}
              onOpenLink={handleOpenLink}
            />
          )}
          {mainTab === 'tasks' && (
            <TasksView
              bot={selectedBot}
              error={tasksError}
              onSave={handleSaveTasks}
              onRunNow={(taskId) => {
                setTasksError(null);
                selectedBot && bridge.runTask(selectedBot.id, taskId);
              }}
              onOpenEditor={(task) => {
                setTaskBeingEdited(task);
                setTaskEditorOpen(true);
              }}
            />
          )}
        </div>
        <TaskEditorView
          open={taskEditorOpen}
          task={taskBeingEdited}
          onClose={() => setTaskEditorOpen(false)}
          onSubmit={(task) => {
            handleSubmitTask(task);
            setTaskEditorOpen(false);
          }}
        />
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
          onRequestDelete={() => setDeleteDialogOpen(true)}
          onSave={(settings: BotSettingsDraft) => {
            setSettingsError(null);
            // A feladatlistát a bot friss állapotából adjuk át — a Settings lap nem birtokolja.
            selectedBot && bridge.saveSettings(selectedBot.id, settings, selectedBot.scheduledTasks);
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
      {deleteDialogOpen && selectedBot && (
        <DeleteBotDialog
          botName={selectedBot.name}
          onClose={() => setDeleteDialogOpen(false)}
          onConfirm={() => {
            setDeleteDialogOpen(false);
            setSettingsError(null);
            // A Settings lapot NEM zárjuk be azonnal: ha a törlés meghiúsul, a hibaüzenet itt
            // jelenik meg. Sikeres törléskor a bot eltűnése zárja be (ld. botList kezelése).
            setPendingDeleteBotId(selectedBot.id);
            bridge.deleteBot(selectedBot.id);
          }}
        />
      )}
      {pendingNavigation && (
        <ConfirmDialog
          title="Mentetlen módosítások"
          message="A Settings lapon mentetlen módosítások vannak, és a botváltás bezárja a lapot. Biztosan folytatod mentés nélkül?"
          confirmLabel="Folytatás mentés nélkül"
          onCancel={() => setPendingNavigation(null)}
          onConfirm={() => {
            // A jelzőt azonnal töröljük: a Settings lap csak a következő renderben kapja meg az
            // új bot piszkozatát, addig a régi (mentetlen) állapot alapján még dirty-t jelentene.
            setSettingsDirty(false);
            pendingNavigation();
            setPendingNavigation(null);
          }}
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
