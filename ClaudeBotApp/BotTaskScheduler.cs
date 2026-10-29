namespace ClaudeBotApp;

/// <summary>
/// Az ütemezett feladatok végrehajtó motorja (ADR-0001, UC-013). Pollozó időzítővel dolgozik:
/// rendszeres időközönként összehasonlítja a feladatok következő futási idejét az aktuális
/// idővel. Ez a gép alvását/ébredését, az óraátállítást és a hosszabb kihagyást külön kód nélkül
/// kezeli, mert csak összehasonlítást végez.
///
/// A név szándékosan nem "TaskScheduler": az ütközne a .NET
/// <see cref="System.Threading.Tasks.TaskScheduler"/> típusával, ami az implicit using-ok miatt
/// mindig látható lenne.
/// </summary>
public class BotTaskScheduler
{
    /// <summary>Az ébredés gyakorisága. Perc-granularitású ütemezéshez a ≤30s késés érdektelen.</summary>
    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(30);

    /// <summary>Ennél régebbi kimaradt futást már nem pótolunk, csak átugrunk (ADR-0001).
    /// Mivel feladatonként csak egyetlen következő időpontot tartunk nyilván, a pótlás
    /// automatikusan legfeljebb egy futás — nem keletkezhet futás-áradat.</summary>
    private static readonly TimeSpan CatchUpWindow = TimeSpan.FromHours(3);

    private readonly BotSessionManager _manager;
    private readonly System.Windows.Forms.Timer _timer = new();

    /// <summary>Folyamatban lévő feladat-futások prompt-uuid szerint. A befejezést a
    /// <see cref="BotSessionManager.TurnCompleted"/> esemény hozza, háttérszálon — ezért minden
    /// hozzáférés a <see cref="_gate"/> alatt történik.</summary>
    private readonly Dictionary<string, InFlightRun> _inFlight = new();
    private readonly object _gate = new();

    /// <summary>A feladatot AZONOSÍTÓVAL tartjuk nyilván, nem objektum-referenciával: minden
    /// mentés új <see cref="ScheduledTask"/> példányokat hoz létre (ld. MergeScheduledTasks),
    /// így egy futás közbeni mentés után a régi referenciára írt eredmény elveszne. A
    /// <see cref="BotSession"/> ezzel szemben stabil objektum, átnevezést is túlél.</summary>
    private sealed record InFlightRun(BotSession Bot, string TaskId);

    public BotTaskScheduler(BotSessionManager manager)
    {
        _manager = manager;
        _manager.TurnCompleted += OnTurnCompleted;

        _timer.Interval = (int)TickInterval.TotalMilliseconds;
        _timer.Tick += (_, _) => Tick(DateTime.Now);
    }

    public void Start()
    {
        // Azonnal futtatunk egy kört, hogy az indulás utáni esedékes/kimaradt feladatok ne
        // várjanak a következő ébredésig.
        Tick(DateTime.Now);
        _timer.Start();
    }

    public void Stop() => _timer.Stop();

    private void Tick(DateTime now)
    {
        foreach (var bot in _manager.Bots.ToList())
        {
            foreach (var task in bot.ScheduledTasks.ToList())
            {
                if (!task.Enabled || task.NextRunAt is not { } dueAt || dueAt > now)
                    continue;

                if (now - dueAt > CatchUpWindow)
                {
                    // Túl régi kimaradás: nem pótoljuk, de láthatóvá tesszük, hogy kimaradt —
                    // különben a felhasználó nem venné észre a némán elhasalt feladatot (UC-015).
                    RecordOutcome(bot, task, TaskRunOutcome.Skipped,
                        "Az alkalmazás nem futott az esedékes időpontban, ezért ez a kör kimaradt.", now);
                    continue;
                }

                StartRun(bot, task, now);
            }
        }
    }

    /// <summary>Kézi, azonnali futtatás (UC-014). Szüneteltetett feladat is indítható így, és az
    /// automatikus ütemezés időpontját nem érinti.</summary>
    public (bool started, string? error) RunNow(string botId, string taskId)
    {
        var bot = _manager.FindBot(botId);
        var task = bot?.ScheduledTasks.FirstOrDefault(t => t.Id == taskId);

        if (bot == null || task == null)
            return (false, "A feladat nem található.");

        if (IsRunning(task.Id))
            return (false, "Ez a feladat éppen fut.");

        if (bot.Status != BotStatus.Running)
            return (false, "A bot nem fut, ezért a feladat nem indítható el.");

        return Dispatch(bot, task, DateTime.Now, advanceSchedule: false)
            ? (true, null)
            : (false, "A feladat promptját nem sikerült elküldeni.");
    }

    private void StartRun(BotSession bot, ScheduledTask task, DateTime now)
    {
        if (IsRunning(task.Id))
        {
            RecordOutcome(bot, task, TaskRunOutcome.Skipped,
                "Az előző futás még tartott, ezért ez a kör kimaradt.", now);
            return;
        }

        if (bot.Status != BotStatus.Running)
        {
            RecordOutcome(bot, task, TaskRunOutcome.Failed,
                "A bot nem futott az esedékes időpontban.", now);
            return;
        }

        if (!Dispatch(bot, task, now, advanceSchedule: true))
        {
            RecordOutcome(bot, task, TaskRunOutcome.Failed,
                "A feladat promptját nem sikerült elküldeni.", now);
        }
    }

    /// <summary>Elküldi a feladat promptját és nyilvántartásba veszi a futást. Automatikus
    /// futásnál a következő időpontot azonnal előre is tolja — enélkül a következő ébredés
    /// ugyanazt a kört újra elindítaná, mert az esedékesség még mindig a múltban lenne.</summary>
    private bool Dispatch(BotSession bot, ScheduledTask task, DateTime now, bool advanceSchedule)
    {
        var uuid = bot.SendPrompt(task.Prompt, null, task.Name);
        if (uuid == null)
            return false;

        lock (_gate)
        {
            _inFlight[uuid] = new InFlightRun(bot, task.Id);
        }

        if (advanceSchedule)
            task.NextRunAt = TaskScheduleCalculator.ComputeNextRun(task.Schedule, now);

        _manager.PersistBot(bot);
        return true;
    }

    /// <summary>Háttérszálon hívódik, amikor egy prompt feldolgozása véget ér. A chat-üzenetek
    /// befejezését figyelmen kívül hagyjuk — azok nincsenek a nyilvántartásban.</summary>
    private void OnTurnCompleted(BotSession bot, string uuid, bool isError)
    {
        InFlightRun? run;
        lock (_gate)
        {
            if (!_inFlight.Remove(uuid, out run))
                return;
        }

        // A feladatot frissen keressük ki: közben törölhették vagy újramenthették.
        var task = run.Bot.ScheduledTasks.FirstOrDefault(t => t.Id == run.TaskId);
        if (task == null)
            return;

        RecordOutcome(
            run.Bot,
            task,
            isError ? TaskRunOutcome.Failed : TaskRunOutcome.Success,
            isError ? "A bot hibával zárta a futást — a részletek a csevegésben olvashatók." : null,
            DateTime.Now,
            advanceSchedule: false);
    }

    private bool IsRunning(string taskId)
    {
        lock (_gate)
        {
            return _inFlight.Values.Any(r => r.TaskId == taskId);
        }
    }

    /// <summary>Rögzíti a futás kimenetelét és menti. <paramref name="advanceSchedule"/> csak
    /// akkor igaz, ha a futás el sem indult — ilyenkor itt kell a következő időpontot előre
    /// tolni, különben a kör azonnal megismétlődne.</summary>
    private void RecordOutcome(
        BotSession bot, ScheduledTask task, TaskRunOutcome outcome, string? error, DateTime at,
        bool advanceSchedule = true)
    {
        task.LastRun = new TaskRun { At = at, Outcome = outcome, Error = error };

        if (advanceSchedule)
        {
            task.NextRunAt = task.Enabled
                ? TaskScheduleCalculator.ComputeNextRun(task.Schedule, at)
                : null;
        }

        _manager.PersistBot(bot);
    }
}
