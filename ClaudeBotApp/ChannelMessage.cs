namespace ClaudeBotApp;

/// <summary>Egy bot-csatorna üzenet (UC-021). A csatorna szándékosan nincs particionálva: egyetlen
/// közös buszon él minden üzenet, a <see cref="To"/> csak azt mondja meg, kinek KÉZBESÍTETTÜK —
/// üres lista esetén az üzenet minden (futó, csatornán részt vevő) bothoz kiment.</summary>
public record ChannelMessage(
    string Id,
    string FromBotId,
    string FromDisplayName,
    IReadOnlyList<string> To,
    string Text,

    /// <summary>A mellékelt fájlok neve a KÜLDŐ munkamappájához képest. A címzetteknél ugyanezek
    /// a fájlok más útvonalon élnek (minden bot csak a saját munkamappáját látja), ezért itt a
    /// küldő-oldali nevet őrizzük meg — ez az, amit a felhasználó és a küldő bot is ismer.</summary>
    IReadOnlyList<string> Files,

    DateTime SentAt,

    /// <summary>Hányadik láncszem: a felhasználótól/ütemezőtől indult körből küldött üzenet 0, az
    /// erre érkező válasz 1, és így tovább. Ez korlátozza a botok közti végtelen oda-vissza
    /// üzengetést (ld. <see cref="BotMessageBus.MaxHop"/>).</summary>
    int Hop);

/// <summary>A csatorna egy résztvevője — ezt látja a bot a `list_bots` tool válaszában, ebből tudja
/// eldönteni, kinek érdemes címeznie.</summary>
public record ChannelParticipant(
    string Name,
    string DisplayName,
    BotStatus Status,
    bool ChannelEnabled,

    /// <summary>Az `agent.md` első néhány értelmes sora — a bot "szakterülete", ha definiálva van.</summary>
    string? Description);
