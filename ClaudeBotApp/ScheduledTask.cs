namespace ClaudeBotApp;

/// <summary>Ütemezés-típusok (UC-010). Nincs külön "naponta" típus: a napi ismétlődés a
/// <see cref="TaskScheduleType.Weekly"/> mind a hét napjának kijelölésével adható meg.</summary>
public enum TaskScheduleType
{
    /// <summary>"Naponta többször" — két futás között eltelő idő.</summary>
    Interval,
    Weekly,
    Monthly,
}

/// <summary>Egy futás kimenetele (UC-013, UC-015).</summary>
public enum TaskRunOutcome
{
    Success,
    Failed,
    Skipped,
}

public class TaskSchedule
{
    public TaskScheduleType Type { get; set; } = TaskScheduleType.Weekly;

    /// <summary><see cref="TaskScheduleType.Interval"/> esetén: két futás között eltelő percek.</summary>
    public int? IntervalMinutes { get; set; }

    /// <summary>Weekly/Monthly esetén a futás időpontja "HH:MM" alakban.</summary>
    public string? TimeOfDay { get; set; }

    /// <summary>Weekly esetén a futás napjai, 0 = vasárnap … 6 = szombat.</summary>
    public List<int>? DaysOfWeek { get; set; }

    /// <summary>Monthly esetén a hónap napjai 1–31 között. A hónap hosszánál nagyobb napszám a
    /// hónap utolsó napjára csonkolódik (ld. ADR-0001).</summary>
    public List<int>? DaysOfMonth { get; set; }
}

public class TaskRun
{
    public DateTime At { get; set; }
    public TaskRunOutcome Outcome { get; set; }

    /// <summary>Failed/Skipped esetén a felhasználónak megjelenített rövid ok.</summary>
    public string? Error { get; set; }
}

/// <summary>Egy bot-onként definiált, ütemezett feladat. A definíciós mezőket a felület
/// szerkeszti, a futásidejű mezőket (<see cref="LastRun"/>, <see cref="NextRunAt"/>) a
/// scheduler írja — mentéskor a kettőt azonosító alapján össze kell fésülni, nem felülírni
/// (ld. ADR-0001).</summary>
public class ScheduledTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string Prompt { get; set; } = "";
    public TaskSchedule Schedule { get; set; } = new();

    /// <summary>false = szüneteltetve: nem fut automatikusan, kézzel továbbra is indítható (UC-012).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>null, ha a feladat még sosem futott le.</summary>
    public TaskRun? LastRun { get; set; }

    /// <summary>null, ha szüneteltetett vagy az ütemezés nem értelmezhető.</summary>
    public DateTime? NextRunAt { get; set; }
}

