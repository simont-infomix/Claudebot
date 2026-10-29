namespace ClaudeBotApp;

/// <summary>
/// Az ütemezésből számolja ki a következő futás időpontját (ADR-0001). Szándékosan állapotmentes:
/// mindig a definícióból dolgozik, nem "utolsó futás + intervallum" alapon — így az alkalmazás
/// újraindítása, a gép alvása és a nyári/téli időszámítás váltása után is magától helyes marad.
/// </summary>
public static class TaskScheduleCalculator
{
    /// <summary>Legfeljebb ennyi hónapot nézünk előre havi ütemezésnél. Három hónap bőven elég:
    /// bármely érvényes napszám legkésőbb a következő hónapban előfordul.</summary>
    private const int MonthLookaheadLimit = 3;

    /// <summary>
    /// A <paramref name="after"/> időpont után következő első futás, vagy null, ha az ütemezés
    /// nem értelmezhető (pl. nincs kijelölt nap, vagy nulla az intervallum).
    /// </summary>
    public static DateTime? ComputeNextRun(TaskSchedule schedule, DateTime after)
    {
        return schedule.Type switch
        {
            TaskScheduleType.Interval => NextInterval(schedule, after),
            TaskScheduleType.Weekly => NextWeekly(schedule, after),
            TaskScheduleType.Monthly => NextMonthly(schedule, after),
            _ => null,
        };
    }

    /// <summary>
    /// "Naponta többször": a réseket éjféltől indexeljük, napi újraindulással. Ha az intervallum
    /// nem osztja a 24 órát, a nap utolsó rése rövidebb lesz — ez tudatosan vállalt (ADR-0001).
    /// </summary>
    private static DateTime? NextInterval(TaskSchedule schedule, DateTime after)
    {
        var interval = schedule.IntervalMinutes ?? 0;
        if (interval <= 0)
            return null;

        var dayStart = after.Date;
        var elapsed = (after - dayStart).TotalMinutes;

        // A következő rés indexe: a jelenlegi rés után eggyel — így mindig szigorúan `after` utáni.
        var slotIndex = (int)Math.Floor(elapsed / interval) + 1;
        var candidate = dayStart.AddMinutes((double)slotIndex * interval);

        // Ha a következő rés már átlógna a holnapba, a napi újraindulás miatt holnap éjfél jön.
        return candidate < dayStart.AddDays(1) ? candidate : dayStart.AddDays(1);
    }

    private static DateTime? NextWeekly(TaskSchedule schedule, DateTime after)
    {
        var days = schedule.DaysOfWeek;
        if (days == null || days.Count == 0)
            return null;

        if (ParseTimeOfDay(schedule.TimeOfDay) is not { } time)
            return null;

        // Nyolc napot nézünk végig: a mai nap (ha az időpont még hátravan) plus egy teljes hét.
        for (var offset = 0; offset <= 7; offset++)
        {
            var day = after.Date.AddDays(offset);
            if (!days.Contains((int)day.DayOfWeek))
                continue;

            var candidate = day + time;
            if (candidate > after)
                return candidate;
        }

        return null;
    }

    /// <summary>
    /// "Havonta": a hónap hosszánál nagyobb napszám a hónap utolsó napjára csonkolódik. A
    /// csonkolás eredményét halmazként kezeljük, hogy pl. a 29+30+31 együttes kijelölése
    /// februárban egyetlen futást váltson ki, ne hármat (ADR-0001).
    /// </summary>
    private static DateTime? NextMonthly(TaskSchedule schedule, DateTime after)
    {
        var days = schedule.DaysOfMonth;
        if (days == null || days.Count == 0)
            return null;

        if (ParseTimeOfDay(schedule.TimeOfDay) is not { } time)
            return null;

        var month = new DateTime(after.Year, after.Month, 1);

        for (var i = 0; i < MonthLookaheadLimit; i++, month = month.AddMonths(1))
        {
            var daysInMonth = DateTime.DaysInMonth(month.Year, month.Month);

            var candidates = days
                .Where(d => d >= 1)
                .Select(d => Math.Min(d, daysInMonth))
                .Distinct()
                .Select(d => new DateTime(month.Year, month.Month, d) + time)
                .Where(c => c > after)
                .ToList();

            if (candidates.Count > 0)
                return candidates.Min();
        }

        return null;
    }

    /// <summary>"HH:MM" alak elemzése; null, ha hiányzik vagy érvénytelen.</summary>
    private static TimeSpan? ParseTimeOfDay(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var parts = value.Split(':');
        if (parts.Length != 2)
            return null;

        if (!int.TryParse(parts[0], out var hours) || !int.TryParse(parts[1], out var minutes))
            return null;

        if (hours is < 0 or > 23 || minutes is < 0 or > 59)
            return null;

        return new TimeSpan(hours, minutes, 0);
    }
}
