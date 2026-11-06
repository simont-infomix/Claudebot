using System.ComponentModel;
using ModelContextProtocol.Server;

namespace ClaudeBotApp;

/// <summary>
/// A bot saját ütemezett feladatainak kezelése MCP tool-okon keresztül (UC-022, ADR-0006). A hívó
/// bot kiléte — ahogy a csatorna-eszközöknél is — az URL tokenjéből derül ki, ezért egy bot
/// kizárólag a SAJÁT feladatait látja és módosíthatja; más botét megszólítani sincs módja.
///
/// Törlés szándékosan nincs: a felhasználó által felvett feladat nem tűnhet el a háta mögött. A
/// legerősebb, amit a bot tehet, a szüneteltetés (`enabled: false`), ami a felületen látszik és
/// egy kattintással visszavonható.
/// </summary>
[McpServerToolType]
public sealed class BotTaskTools
{
    private readonly ChannelBackend _backend;
    private readonly CallerBotAccessor _caller;

    public BotTaskTools(ChannelBackend backend, CallerBotAccessor caller)
    {
        _backend = backend;
        _caller = caller;
    }

    [McpServerTool(Name = HostToolNames.ListTasks, ReadOnly = true),
     Description("Felsorolja a SAJÁT ütemezett feladataidat: mit kérnek tőled, milyen " +
                 "ütemezéssel, mikor futnak legközelebb, és hogyan sikerült a legutóbbi futás. " +
                 "Akkor hasznos, ha tudni akarod, mi a rendszeres dolgod, vagy ha a felhasználó " +
                 "a feladataidról kérdez. A feladat azonosítóját az `update_task` tool kéri.")]
    public string ListTasks()
    {
        if (!TryGetContext(out _, out var caller, out var error))
            return error;

        var tasks = caller.ScheduledTasks;
        if (tasks.Count == 0)
            return "Nincs ütemezett feladatod.";

        return string.Join("\n\n", tasks.Select(Describe));
    }

    [McpServerTool(Name = HostToolNames.AddTask),
     Description("Új ütemezett feladatot vesz fel MAGADNAK: a megadott időpontokban a prompt " +
                 "szövege önálló körként fog elindulni nálad, felhasználói üzenet nélkül. Akkor " +
                 "használd, ha a felhasználó rendszeresen ismétlődő munkát kér tőled (\"minden " +
                 "reggel nézd meg a…\"). A prompt legyen önmagában érthető: a futásakor nem lesz " +
                 "melletted a mostani beszélgetés kontextusa.")]
    public string AddTask(
        [Description("A feladat rövid, beszédes neve — ez azonosítja a felületen és a naplóban.")]
        string name,
        [Description("A prompt, ami a feladat futásakor elindul. Önmagában érthetően fogalmazd meg.")]
        string prompt,
        [Description("Az ütemezés típusa: `interval` (naponta többször, adott percenként), " +
                     "`weekly` (a hét megadott napjain, adott időpontban) vagy `monthly` (a hónap " +
                     "megadott napjain, adott időpontban).")]
        string scheduleType,
        [Description("`interval` esetén: két futás között eltelő percek száma.")]
        int? intervalMinutes = null,
        [Description("`weekly`/`monthly` esetén: a futás időpontja „HH:MM” alakban (pl. `08:30`).")]
        string? timeOfDay = null,
        [Description("`weekly` esetén: a futás napjai, 0 = vasárnap … 6 = szombat.")]
        int[]? daysOfWeek = null,
        [Description("`monthly` esetén: a hónap napjai 1–31 között. A hónap hosszánál nagyobb " +
                     "napszám az adott hónap utolsó napjára csúszik.")]
        int[]? daysOfMonth = null)
    {
        if (!TryGetContext(out var manager, out var caller, out var error))
            return error;

        if (string.IsNullOrWhiteSpace(name))
            return "A feladatnak nevet kell adni.";

        if (string.IsNullOrWhiteSpace(prompt))
            return "A feladatnak promptot kell adni — e nélkül nem lenne mit futtatni.";

        var (schedule, scheduleError) = BuildSchedule(
            scheduleType, intervalMinutes, timeOfDay, daysOfWeek, daysOfMonth);

        if (schedule == null)
            return scheduleError!;

        var task = new ScheduledTask
        {
            Name = name.Trim(),
            Prompt = prompt.Trim(),
            Schedule = schedule,
            Enabled = true,
            NextRunAt = TaskScheduleCalculator.ComputeNextRun(schedule, DateTime.Now),
        };

        manager.AddScheduledTask(caller, task);
        caller.LogTaskActivity($"📋 Új ütemezett feladat: „{task.Name}” — {DescribeSchedule(task.Schedule)}");

        return $"Felvettem a(z) „{task.Name}” feladatot (azonosító: {task.Id}). " +
               $"{NextRunSentence(task)} A felhasználó a Feladatok fülön látja és bármikor " +
               "módosíthatja.";
    }

    [McpServerTool(Name = HostToolNames.UpdateTask),
     Description("Módosítja a SAJÁT, már létező ütemezett feladatodat: a nevét, a promptját, az " +
                 "ütemezését, vagy szünetelteti/újraindítja. Csak azt add meg, amit változtatni " +
                 "akarsz — a többi mező érintetlen marad. Törölni nem tudsz feladatot; ha egy " +
                 "feladat feleslegessé vált, szüneteltesd (`enabled: false`), és szólj a " +
                 "felhasználónak.")]
    public string UpdateTask(
        [Description("A módosítandó feladat azonosítója a `list_tasks` szerint.")]
        string taskId,
        [Description("Az új név, ha változtatni akarod.")]
        string? name = null,
        [Description("Az új prompt, ha változtatni akarod.")]
        string? prompt = null,
        [Description("`false` = szüneteltetés (nem fut automatikusan), `true` = újraindítás.")]
        bool? enabled = null,
        [Description("Az ütemezés új típusa (`interval`, `weekly`, `monthly`). Ha megadod, a " +
                     "hozzá tartozó mezőket is meg kell adnod — az ütemezés egyben cserélődik.")]
        string? scheduleType = null,
        [Description("`interval` esetén: két futás között eltelő percek száma.")]
        int? intervalMinutes = null,
        [Description("`weekly`/`monthly` esetén: a futás időpontja „HH:MM” alakban.")]
        string? timeOfDay = null,
        [Description("`weekly` esetén: a futás napjai, 0 = vasárnap … 6 = szombat.")]
        int[]? daysOfWeek = null,
        [Description("`monthly` esetén: a hónap napjai 1–31 között.")]
        int[]? daysOfMonth = null)
    {
        if (!TryGetContext(out var manager, out var caller, out var error))
            return error;

        if (string.IsNullOrWhiteSpace(taskId))
            return "Meg kell adnod a módosítandó feladat azonosítóját (`list_tasks`).";

        TaskSchedule? newSchedule = null;
        if (!string.IsNullOrWhiteSpace(scheduleType))
        {
            var (schedule, scheduleError) = BuildSchedule(
                scheduleType, intervalMinutes, timeOfDay, daysOfWeek, daysOfMonth);

            if (schedule == null)
                return scheduleError!;

            newSchedule = schedule;
        }

        ScheduledTask? updated = null;
        var found = manager.UpdateScheduledTask(caller, taskId.Trim(), task =>
        {
            if (!string.IsNullOrWhiteSpace(name))
                task.Name = name.Trim();

            if (!string.IsNullOrWhiteSpace(prompt))
                task.Prompt = prompt.Trim();

            if (enabled.HasValue)
                task.Enabled = enabled.Value;

            if (newSchedule != null)
                task.Schedule = newSchedule;

            // A következő futást minden módosítás után újraszámoljuk: a szüneteltetés törli, az
            // újraindítás és az ütemezés-csere pedig a friss definícióból állítja be. E nélkül egy
            // szüneteltetett feladat régi időpontja bent ragadna, és visszakapcsoláskor azonnal
            // esedékesnek látszana.
            task.NextRunAt = task.Enabled
                ? TaskScheduleCalculator.ComputeNextRun(task.Schedule, DateTime.Now)
                : null;

            updated = task;
        });

        if (!found || updated == null)
            return $"Nincs „{taskId}” azonosítójú feladatod — a `list_tasks` tool-lal nézheted meg a sajátjaidat.";

        var state = updated.Enabled ? DescribeSchedule(updated.Schedule) : "szüneteltetve";
        caller.LogTaskActivity($"📋 Módosított ütemezett feladat: „{updated.Name}” — {state}");

        return $"Módosítottam a(z) „{updated.Name}” feladatot. {NextRunSentence(updated)}";
    }

    /// <summary>A bot felé menő, ember-olvasható feladatleírás. Szándékosan szöveg, nem JSON: a
    /// modell ezt olvassa, és a számára fontos mezők (mit, mikor, hogyan sikerült) így a
    /// legtömörebbek.</summary>
    private static string Describe(ScheduledTask task)
    {
        var state = task.Enabled ? "aktív" : "szüneteltetve";
        var lines = new List<string>
        {
            $"- „{task.Name}” ({state}, azonosító: {task.Id})",
            $"  Ütemezés: {DescribeSchedule(task.Schedule)}",
            $"  Következő futás: {(task.NextRunAt is { } next ? next.ToString("yyyy-MM-dd HH:mm") : "nincs ütemezve")}",
        };

        if (task.LastRun is { } last)
        {
            var outcome = last.Outcome switch
            {
                TaskRunOutcome.Success => "sikeres",
                TaskRunOutcome.Failed => "sikertelen",
                _ => "kimaradt",
            };

            var reason = string.IsNullOrWhiteSpace(last.Error) ? "" : $" — {last.Error}";
            lines.Add($"  Utolsó futás: {last.At:yyyy-MM-dd HH:mm}, {outcome}{reason}");
        }

        lines.Add($"  Prompt: {task.Prompt}");
        return string.Join("\n", lines);
    }

    private static string DescribeSchedule(TaskSchedule schedule) => schedule.Type switch
    {
        TaskScheduleType.Interval => schedule.IntervalMinutes is { } minutes and > 0
            ? $"naponta többször, {minutes} percenként"
            : "érvénytelen (nincs megadva az intervallum)",

        TaskScheduleType.Weekly => schedule.DaysOfWeek is { Count: > 0 } days
            ? $"hetente {string.Join(", ", days.OrderBy(d => d).Select(DayName))} {schedule.TimeOfDay}"
            : "érvénytelen (nincs kijelölt nap)",

        TaskScheduleType.Monthly => schedule.DaysOfMonth is { Count: > 0 } days
            ? $"havonta {string.Join(", ", days.OrderBy(d => d).Select(d => $"{d}."))} {schedule.TimeOfDay}"
            : "érvénytelen (nincs kijelölt nap)",

        _ => "ismeretlen",
    };

    private static string DayName(int day) => day switch
    {
        0 => "vasárnap",
        1 => "hétfő",
        2 => "kedd",
        3 => "szerda",
        4 => "csütörtök",
        5 => "péntek",
        6 => "szombat",
        _ => $"?{day}",
    };

    private static string NextRunSentence(ScheduledTask task) =>
        task.NextRunAt is { } next
            ? $"A következő futás: {next:yyyy-MM-dd HH:mm}."
            : "Jelenleg nincs ütemezett következő futása (szüneteltetve van).";

    /// <summary>
    /// A tool paramétereiből épít ütemezést, és érvénytelen bemenetnél a bot számára érthető hibát
    /// ad vissza. A záró ellenőrzés nem külön szabályhalmaz: magát a menetrend-számítót kérdezzük
    /// meg, így nem keletkezhet olyan ütemezés, amit a scheduler később nem tudna értelmezni.
    /// </summary>
    private static (TaskSchedule? Schedule, string? Error) BuildSchedule(
        string? scheduleType, int? intervalMinutes, string? timeOfDay, int[]? daysOfWeek, int[]? daysOfMonth)
    {
        var schedule = new TaskSchedule();

        switch ((scheduleType ?? "").Trim().ToLowerInvariant())
        {
            case "interval":
                if (intervalMinutes is not { } minutes || minutes <= 0)
                    return (null, "`interval` ütemezéshez az `intervalMinutes` kötelező, és nagyobb kell legyen nullánál.");

                schedule.Type = TaskScheduleType.Interval;
                schedule.IntervalMinutes = minutes;
                break;

            case "weekly":
                if (daysOfWeek == null || daysOfWeek.Length == 0)
                    return (null, "`weekly` ütemezéshez meg kell adnod a `daysOfWeek` listát (0 = vasárnap … 6 = szombat).");

                if (daysOfWeek.Any(d => d is < 0 or > 6))
                    return (null, "A `daysOfWeek` értékei 0 és 6 közé eshetnek (0 = vasárnap … 6 = szombat).");

                schedule.Type = TaskScheduleType.Weekly;
                schedule.DaysOfWeek = daysOfWeek.Distinct().OrderBy(d => d).ToList();
                schedule.TimeOfDay = timeOfDay?.Trim();
                break;

            case "monthly":
                if (daysOfMonth == null || daysOfMonth.Length == 0)
                    return (null, "`monthly` ütemezéshez meg kell adnod a `daysOfMonth` listát (1–31).");

                if (daysOfMonth.Any(d => d is < 1 or > 31))
                    return (null, "A `daysOfMonth` értékei 1 és 31 közé eshetnek.");

                schedule.Type = TaskScheduleType.Monthly;
                schedule.DaysOfMonth = daysOfMonth.Distinct().OrderBy(d => d).ToList();
                schedule.TimeOfDay = timeOfDay?.Trim();
                break;

            default:
                return (null, "A `scheduleType` csak `interval`, `weekly` vagy `monthly` lehet.");
        }

        if (TaskScheduleCalculator.ComputeNextRun(schedule, DateTime.Now) == null)
        {
            return (null, "Az így megadott ütemezésből nem jön ki érvényes futási időpont. " +
                          "`weekly`/`monthly` esetén a `timeOfDay` „HH:MM” alakú legyen (pl. `08:30`).");
        }

        return (schedule, null);
    }

    /// <summary>A szerver a botok indulása előtt elindul, a menedzser viszont csak utánuk kötődik
    /// be — egy ebben a résben érkező hívásra értelmes hibaszöveget adunk, nem kivételt.</summary>
    private bool TryGetContext(out BotSessionManager manager, out BotSession caller, out string error)
    {
        manager = _backend.Manager!;
        caller = _caller.Bot!;

        if (_backend.Manager == null || _caller.Bot == null)
        {
            error = "A feladataid jelenleg nem érhetők el. Próbáld újra később.";
            return false;
        }

        error = "";
        return true;
    }
}
