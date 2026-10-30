namespace ClaudeBotApp;

/// <summary>Egy tool-jóváhagyási kérés sorsa. A Pending-en kívüli értékek véglegesek:
/// egy kérésre pontosan egy válasz mehet ki a claude.exe felé.</summary>
public enum PermissionDecision
{
    /// <summary>Válaszra vár.</summary>
    Pending,

    /// <summary>Egyszeri engedély erre a hívásra.</summary>
    Allowed,

    /// <summary>Engedély, és az eszköz tartósan felkerült a bot engedélyezett listájára.</summary>
    AllowedAlways,

    /// <summary>A felhasználó elutasította.</summary>
    Denied,

    /// <summary>A felhasználó megválaszolta a bot kérdését (AskUserQuestion, UC-020).</summary>
    Answered,

    /// <summary>A felhasználó explicit kihagyta a kérdést — a bot "nem válaszolt" jelzést kap,
    /// de ez (az általános jóváhagyási kéréssel ellentétben) NEM számít a kör sikertelenségének:
    /// a claude.exe ezt a tool saját, kész szövegével ("The user did not answer...") zárja le.</summary>
    Skipped,

    /// <summary>Nem érkezett válasz a határidőig. Jóváhagyási kérésnél ez automatikus
    /// elutasítást jelent (a kör sikertelen lesz); kérdésnél (AskUserQuestion) a <see cref="Skipped"/>-del
    /// azonos módon kezelve — a kör sikeresen lezárul, csak válasz nélkül.</summary>
    TimedOut,

    /// <summary>A bot folyamata leállt/újraindult, mielőtt válasz született volna — a
    /// kérés azonosítója ezzel értelmét vesztette, választ már nem lehet rá küldeni.</summary>
    Cancelled,
}

/// <summary>Egy AskUserQuestion kérdés egy választható opciója.</summary>
public sealed record UserQuestionOption(string Label, string? Description);

/// <summary>Egy AskUserQuestion kérdés — a bot nem engedélyt kér, hanem ténylegesen választ vár
/// a felhasználótól, mielőtt folytatná a kört.</summary>
public sealed record UserQuestion(string Question, string? Header, IReadOnlyList<UserQuestionOption> Options, bool MultiSelect);

/// <summary>
/// A claude.exe egy `can_use_tool` control-kérése: a bot egy olyan eszközt használna, amire
/// nincs előzetes engedélye (UC-018). A kérés azonosítója (<see cref="RequestId"/>) kizárólag
/// az őt kiállító claude.exe példányon belül érvényes, ezért a nyilvántartása a
/// <see cref="BotSession"/>-ben él, és a folyamat leállásakor érvénytelenné válik.
/// </summary>
public sealed class PermissionRequest
{
    public required string RequestId { get; init; }
    public required string ToolName { get; init; }

    /// <summary>Egysoros összefoglaló a kért művelet lényegéről (pl. a futtatandó parancs).</summary>
    public required string InputSummary { get; init; }

    /// <summary>A teljes input JSON-ja, a felületen lenyitható részletekhez.</summary>
    public required string InputJson { get; init; }

    /// <summary>A CLI indoklása, miért kell jóváhagyás (pl. "This command requires approval").</summary>
    public string? DecisionReason { get; init; }

    /// <summary>Melyik kör (prompt) váltotta ki — ebből derül ki, hogy ütemezett feladat
    /// futásáról van-e szó, és melyik feladat futását kell sikertelennek jelölni, ha a
    /// kérés elutasításra kerül. Null, ha a kör nem azonosítható.</summary>
    public string? OwningPromptUuid { get; init; }

    /// <summary>Ütemezett feladat köre-e — ez dönti el a válaszadási határidőt is.</summary>
    public bool IsScheduledRun { get; init; }

    /// <summary>Igaz, ha ehhez a kéréshez ténylegesen emberi válasz kell, nem csak
    /// engedélyezés/elutasítás (a claude.exe `requires_user_interaction` mezője — jelenleg az
    /// AskUserQuestion tool esetén igaz).</summary>
    public bool RequiresUserInteraction { get; init; }

    /// <summary>Csak akkor nem null, ha <see cref="RequiresUserInteraction"/> igaz és a tool az
    /// AskUserQuestion — a strukturált kérdések, amikre válaszolni kell.</summary>
    public IReadOnlyList<UserQuestion>? Questions { get; init; }

    public DateTime CreatedAt { get; init; }

    /// <summary>Eddig vár a kérés; utána automatikus elutasítás.</summary>
    public DateTime ExpiresAt { get; init; }

    public PermissionDecision Decision { get; set; } = PermissionDecision.Pending;
}

/// <summary>Egy prompt-kör lezárulása. Azért rekord és nem két skalár, mert az elutasított
/// tool-hívás NEM jelenik meg a claude.exe `is_error` mezőjében (mérve: elutasítás után is
/// `is_error: false` érkezik) — a kör sikertelenségét csak a <see cref="FailureReason"/>
/// hordozza, és enélkül egy ütemezett feladat tévesen sikeresként könyvelődne el.</summary>
public readonly record struct TurnResult(string PromptUuid, bool IsError, string? FailureReason)
{
    public bool Failed => IsError || FailureReason != null;
}
