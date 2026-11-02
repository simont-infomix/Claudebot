namespace ClaudeBotApp;

/// <summary>
/// A botok közös üzenet-csatornája (UC-021, ADR-0005). A "subscribe" oldal triviális: a busz a
/// meglévő <see cref="BotSession.SendPrompt"/>-tal kézbesít, vagyis egy beérkező üzenet pontosan
/// úgy indít kört a címzettnél, mint egy felhasználói üzenet. A "publish" oldal a
/// <see cref="ChannelMcpServer"/> tool-jain keresztül érkezik.
///
/// A csatorna NINCS particionálva: egyetlen közös busz van, a címzés (`to`) csak azt szűkíti, kinek
/// kézbesítünk — nem külön csatornákat hoz létre.
///
/// Szálbiztosság: a publikálás a Kestrel kérés-szálairól jön, a kör-befejezések viszont a bot
/// kimenetét olvasó háttérszálról — ezért minden belső állapot a <see cref="_gate"/> alatt él.
/// A tényleges kézbesítés (SendPrompt) szándékosan a zároláson KÍVÜL fut: az eseményeket vált ki,
/// amik a UI-szálra marshalolnak, és egy ilyen hívást nem tartunk zárolás alatt.
/// </summary>
public class BotMessageBus
{
    /// <summary>Ennél mélyebb válasz-láncot nem engedünk: a felhasználótól indult kör 0, az arra
    /// küldött üzenet kézbesítve 1-es körben válaszolhat, és így tovább. Enélkül két bot a végtelenségig
    /// udvariaskodhatna egymással, valódi tokenköltséggel.</summary>
    public const int MaxHop = 3;

    /// <summary>Csúszóablakos darabszám-korlát botonként — egy elszabadult bot ne áraszthassa el a
    /// többit.</summary>
    private const int MaxMessagesPerWindow = 10;
    private static readonly TimeSpan RateWindow = TimeSpan.FromMinutes(5);

    /// <summary>Ennyi üzenetet tartunk meg visszanézésre (`recent_messages`). Memóriában él, az app
    /// újraindításakor törlődik — ahogy a beszélgetés-előzmény is.</summary>
    private const int HistoryLimit = 200;

    private readonly BotSessionManager _manager;
    private readonly object _gate = new();

    /// <summary>Kézbesített üzenetből indult körök lánc-mélysége (prompt uuid → hop). A kör
    /// lezárultakor töröljük, különben a szótár a futásidő alatt folyamatosan nőne.</summary>
    private readonly Dictionary<string, int> _turnHop = new();

    /// <summary>Botonként a legutóbbi publikálások időpontjai — a csúszóablakos korláthoz.</summary>
    private readonly Dictionary<string, List<DateTime>> _sendTimes = new();

    private readonly List<ChannelMessage> _history = new();
    private int _nextMessageNumber = 1;

    public BotMessageBus(BotSessionManager manager)
    {
        _manager = manager;
        _manager.TurnCompleted += OnTurnCompleted;
    }

    /// <summary>Kik vannak a csatornán. A hívót szándékosan kihagyjuk: önmagának úgysem küldhet.</summary>
    public IReadOnlyList<ChannelParticipant> ListParticipants(BotSession caller) =>
        _manager.Bots
            .Where(b => b != caller)
            .Select(b => new ChannelParticipant(
                b.Name, b.DisplayName, b.Status, b.ChannelEnabled, ReadBotDescription(b)))
            .ToList();

    /// <summary>
    /// Üzenet a közös csatornára. A <paramref name="to"/> üres/null értéke esetén minden másik
    /// (futó, csatornán részt vevő) bot megkapja.
    /// A visszatérő szöveg magának a hívó botnak szól: ebből tudja meg, kihez jutott el az üzenet,
    /// kihez nem és miért — enélkül vakon küldene egy épp leállított botnak.
    /// </summary>
    public string Publish(BotSession from, string message, IReadOnlyList<string>? to)
    {
        if (string.IsNullOrWhiteSpace(message))
            return "Az üzenet üres volt, ezért nem került ki a csatornára.";

        if (!from.ChannelEnabled)
        {
            return "Ez a bot nincs rajta a közös csatornán (a felhasználó kikapcsolta a " +
                   "beállításainál), ezért az üzenet nem került kiküldésre.";
        }

        var now = DateTime.Now;

        int hop;
        lock (_gate)
        {
            // A lánc-mélység a kiváltó körből öröklődik: ha ezt a kört egy kézbesített üzenet
            // indította, akkor ez már válasz, és eggyel mélyebben van.
            var currentTurn = from.CurrentTurnUuid;
            hop = currentTurn != null && _turnHop.TryGetValue(currentTurn, out var inherited) ? inherited : 0;

            if (hop >= MaxHop)
            {
                return $"A beszélgetési lánc elérte a maximális mélységet ({MaxHop} válasz), ezért " +
                       "ez az üzenet nem került kiküldésre. Zárd le a témát, és ha szükséges, " +
                       "foglald össze a felhasználónak az eddigi eredményt.";
            }

            if (!TryRecordSend(from.Name, now, out var waitMinutes))
            {
                return $"Túl sok üzenetet küldtél rövid idő alatt (legfeljebb {MaxMessagesPerWindow} / " +
                       $"{RateWindow.TotalMinutes:0} perc), ezért ez az üzenet nem került kiküldésre. " +
                       $"Próbáld újra kb. {waitMinutes} perc múlva, vagy fogalmazz egyetlen üzenetbe mindent.";
            }
        }

        var (recipients, problems) = ResolveRecipients(from, to);

        if (recipients.Count == 0)
        {
            var reason = problems.Count > 0 ? " " + string.Join(" ", problems) : "";
            return "Az üzenet nem jutott el senkihez." + reason;
        }

        string messageId;
        lock (_gate)
        {
            messageId = $"m{_nextMessageNumber++}";
        }

        var channelMessage = new ChannelMessage(
            messageId,
            from.Name,
            from.DisplayName,
            recipients.Select(r => r.Name).ToList(),
            message.Trim(),
            now,
            hop);

        var delivered = new List<string>();
        foreach (var recipient in recipients)
        {
            // Zárolás nélkül: a SendPrompt log-eseményt vált ki, ami a UI-szálra marshalol.
            var uuid = recipient.SendPrompt(FormatDelivery(channelMessage), null, PromptOrigin.Channel);
            if (uuid == null)
            {
                problems.Add($"„{recipient.DisplayName}” nem vette át az üzenetet (a folyamata nem érhető el).");
                continue;
            }

            delivered.Add(recipient.DisplayName);

            lock (_gate)
            {
                _turnHop[uuid] = hop + 1;
            }
        }

        lock (_gate)
        {
            _history.Add(channelMessage);
            if (_history.Count > HistoryLimit)
                _history.RemoveRange(0, _history.Count - HistoryLimit);
        }

        // A küldő csevegésében is látszódjon, mit küldött ki — enélkül a felhasználó számára néma
        // maradna, hogy a bot a háttérben megszólított valakit.
        from.LogChannelActivity(
            $"📣 Üzenet a csatornára → {string.Join(", ", delivered)}: {Shorten(channelMessage.Text)}");

        if (delivered.Count == 0)
            return "Az üzenet nem jutott el senkihez. " + string.Join(" ", problems);

        var result = $"Az üzenet kiment a következő bot(ok)nak: {string.Join(", ", delivered)}. " +
                     "A válaszuk — ha válaszolnak — külön üzenetként fog megérkezni hozzád, nem " +
                     "ennek a tool-hívásnak a visszatérési értékeként.";

        return problems.Count > 0 ? result + " " + string.Join(" ", problems) : result;
    }

    /// <summary>A csatorna utolsó üzenetei — ezzel tud utólag felzárkózni az a bot, amelyik egy
    /// üzenet kiküldésekor épp nem futott.</summary>
    public IReadOnlyList<ChannelMessage> Recent(int limit)
    {
        lock (_gate)
        {
            return _history.TakeLast(Math.Clamp(limit, 1, HistoryLimit)).ToList();
        }
    }

    /// <summary>Feloldja a címzetteket. A kihagyott botokról szöveges indoklás készül, mert ez az
    /// egyetlen visszajelzés, amit a küldő bot kap.</summary>
    private (List<BotSession> Recipients, List<string> Problems) ResolveRecipients(
        BotSession from, IReadOnlyList<string>? to)
    {
        var problems = new List<string>();
        List<BotSession> candidates;

        if (to == null || to.Count == 0)
        {
            candidates = _manager.Bots.Where(b => b != from).ToList();
        }
        else
        {
            candidates = new List<BotSession>();
            foreach (var name in to.Select(n => n?.Trim()).Where(n => !string.IsNullOrEmpty(n)).Distinct())
            {
                // A megjelenített név és az azonosító ma megegyezik, de átnevezés közben
                // eltérhetnek — mindkettőre illesztünk, hogy a bot bármelyiket használhassa.
                var bot = _manager.Bots.FirstOrDefault(b =>
                    string.Equals(b.Name, name, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(b.DisplayName, name, StringComparison.OrdinalIgnoreCase));

                if (bot == null)
                {
                    problems.Add($"Nincs „{name}” nevű bot — a `list_bots` tool-lal nézheted meg, kik vannak a csatornán.");
                    continue;
                }

                if (bot == from)
                {
                    problems.Add("Önmagadnak nem küldhetsz üzenetet.");
                    continue;
                }

                candidates.Add(bot);
            }
        }

        var recipients = new List<BotSession>();
        foreach (var bot in candidates)
        {
            if (!bot.ChannelEnabled)
            {
                problems.Add($"„{bot.DisplayName}” nincs rajta a közös csatornán.");
                continue;
            }

            if (bot.Status != BotStatus.Running)
            {
                problems.Add($"„{bot.DisplayName}” éppen nem fut, ezért nem kapta meg az üzenetet.");
                continue;
            }

            recipients.Add(bot);
        }

        return (recipients, problems);
    }

    /// <summary>A kézbesített prompt. A fejléc és a záró útmutató azért kell, mert a címzett bot
    /// számára ez egy sima felhasználói kör: enélkül nem tudná, kitől jött, és hogy mivel
    /// válaszolhat.</summary>
    private static string FormatDelivery(ChannelMessage message) =>
        $"[Bot-csatorna] „{message.FromDisplayName}” üzenete:\n\n" +
        $"{message.Text}\n\n" +
        $"— Ha válaszolsz, hívd az `mcp__{BotSession.ChannelMcpServerName}__send_message` tool-t a " +
        $"`to: [\"{message.FromBotId}\"]` paraméterrel. Ha a kérés nem rád tartozik, vagy nem tudsz " +
        "érdemben hozzátenni, nyugodtan hagyd figyelmen kívül — nem kötelező válaszolni.";

    /// <summary>A csúszóablakos korlát ellenőrzése és könyvelése egy lépésben. A <see cref="_gate"/>
    /// alatt hívandó.</summary>
    private bool TryRecordSend(string botName, DateTime now, out int waitMinutes)
    {
        if (!_sendTimes.TryGetValue(botName, out var times))
        {
            times = new List<DateTime>();
            _sendTimes[botName] = times;
        }

        times.RemoveAll(t => now - t > RateWindow);

        if (times.Count >= MaxMessagesPerWindow)
        {
            waitMinutes = Math.Max(1, (int)Math.Ceiling((RateWindow - (now - times[0])).TotalMinutes));
            return false;
        }

        times.Add(now);
        waitMinutes = 0;
        return true;
    }

    /// <summary>Háttérszálon hívódik. A lezárult kör lánc-mélységére már nincs szükség.</summary>
    private void OnTurnCompleted(BotSession bot, TurnResult result)
    {
        lock (_gate)
        {
            _turnHop.Remove(result.PromptUuid);
        }
    }

    /// <summary>A bot "szakterülete" az agent.md elejéről — ebből tudja a többi bot, kinek érdemes
    /// címezni. Markdown-címsorokat átugorva az első érdemi bekezdést vesszük.</summary>
    private static string? ReadBotDescription(BotSession bot)
    {
        var path = Path.Combine(bot.FolderPath, BotSession.AgentFileName);
        if (!File.Exists(path))
            return null;

        try
        {
            var line = File.ReadLines(path)
                .Select(l => l.Trim())
                .FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#') && !l.StartsWith("---"));

            return line == null ? null : Shorten(line);
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static string Shorten(string value)
    {
        var singleLine = value.ReplaceLineEndings(" ").Trim();
        return singleLine.Length > 200 ? singleLine[..200] + "…" : singleLine;
    }
}
