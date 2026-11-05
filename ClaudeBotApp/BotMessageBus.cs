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

    /// <summary>A címzett munkamappáján belüli mappa, ahová a kapott fájlok kerülnek, küldőnként
    /// külön alkönyvtárba. Szándékosan nem a munkamappa gyökerébe másolunk: ott egy azonos nevű
    /// fájl némán felülírná a címzett saját munkáját, itt viszont a küldő legfeljebb a korábban
    /// általa küldött fájlt írja felül.</summary>
    public const string IncomingFolderName = "_bejovo";

    /// <summary>Üzenetenként ennyi fájl mehet, egyenként legfeljebb ekkora. A csatorna
    /// munkaanyagok átadására való, nem fájlmásolásra: a nagy adathalmaz másolása mindkét bot
    /// kontextusát és a lemezt is terhelné, ezért inkább korán, érthető hibával elutasítjuk.</summary>
    private const int MaxFilesPerMessage = 5;
    private const long MaxFileBytes = 10L * 1024 * 1024;

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
    /// A <paramref name="files"/> a küldő munkamappájához képest megadott fájlok, amiket a hoszt
    /// minden címzett munkamappájába átmásol — a botok mappái el vannak különítve, egymás fájljait
    /// közvetlenül nem érik el.
    /// A visszatérő szöveg magának a hívó botnak szól: ebből tudja meg, kihez jutott el az üzenet,
    /// kihez nem és miért — enélkül vakon küldene egy épp leállított botnak.
    /// </summary>
    public string Publish(
        BotSession from, string message, IReadOnlyList<string>? to, IReadOnlyList<string>? files = null)
    {
        var hasFiles = files != null && files.Count > 0;
        if (string.IsNullOrWhiteSpace(message) && !hasFiles)
            return "Az üzenet üres volt, ezért nem került ki a csatornára.";

        if (!from.ChannelEnabled)
        {
            return "Ez a bot nincs rajta a közös csatornán (a felhasználó kikapcsolta a " +
                   "beállításainál), ezért az üzenet nem került kiküldésre.";
        }

        // A fájlok feloldása szándékosan a korlátok ELŐTT fut: egy elgépelt fájlnév miatt ne
        // fogyjon a küldési kvóta, és a bot azonnal, érthetően tudja javítani.
        var (attachments, fileProblems) = ResolveFiles(from, files);
        if (attachments.Count == 0 && string.IsNullOrWhiteSpace(message))
        {
            return "Az üzenetnek nem volt szövege, a megadott fájl(oka)t pedig nem lehetett " +
                   "elküldeni, ezért semmi nem került ki a csatornára. " + string.Join(" ", fileProblems);
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
        problems.InsertRange(0, fileProblems);

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
            // Csak fájlt is lehet küldeni, ilyenkor a szöveg üres — a kézbesített prompt és a
            // chat-jelzés is elbírja (ld. FormatDelivery).
            (message ?? "").Trim(),
            attachments.Select(a => a.Name).ToList(),
            now,
            hop);

        var delivered = new List<string>();
        foreach (var recipient in recipients)
        {
            // A másolásnak meg kell előznie a kézbesítést: a prompt @-hivatkozásai a címzett
            // munkamappájában lévő, már létező másolatokra mutatnak.
            var (copied, copyProblem) = CopyToRecipient(from, recipient, attachments);
            if (copyProblem != null)
                problems.Add(copyProblem);

            // Zárolás nélkül: a SendPrompt log-eseményt vált ki, ami a UI-szálra marshalol.
            var uuid = recipient.SendPrompt(
                FormatDelivery(channelMessage, copied.Count > 0), copied, PromptOrigin.Channel);
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
        // maradna, hogy a bot a háttérben megszólított valakit, és főleg az, hogy fájlt is adott át.
        var fileNote = channelMessage.Files.Count > 0
            ? $" 📎 {string.Join(", ", channelMessage.Files)}"
            : "";
        from.LogChannelActivity(
            $"📣 Üzenet a csatornára → {string.Join(", ", delivered)}: {Shorten(channelMessage.Text)}{fileNote}");

        if (delivered.Count == 0)
            return "Az üzenet nem jutott el senkihez. " + string.Join(" ", problems);

        var sentWhat = channelMessage.Files.Count > 0
            ? $"Az üzenet és a mellékelt fájl(ok) — {string.Join(", ", channelMessage.Files)} — kimentek"
            : "Az üzenet kiment";

        var result = $"{sentWhat} a következő bot(ok)nak: {string.Join(", ", delivered)}. " +
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

    /// <summary>
    /// A küldő által megadott fájlok feloldása a saját munkamappájához képest. A bot csak a saját
    /// mappájából küldhet: a feloldott útvonalnak azon belül kell maradnia, különben a csatorna a
    /// gép tetszőleges fájljának átmásolására lenne használható.
    /// A kihagyott fájlokról szöveges indoklás készül — ez az egyetlen visszajelzés, amit a küldő kap.
    /// </summary>
    private static (List<ChannelAttachment> Files, List<string> Problems) ResolveFiles(
        BotSession from, IReadOnlyList<string>? files)
    {
        var resolved = new List<ChannelAttachment>();
        var problems = new List<string>();

        if (files == null || files.Count == 0)
            return (resolved, problems);

        var root = Path.GetFullPath(from.FolderPath);
        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

        foreach (var requested in files.Select(f => f?.Trim()).Where(f => !string.IsNullOrEmpty(f)).Distinct())
        {
            if (resolved.Count >= MaxFilesPerMessage)
            {
                problems.Add($"Egy üzenethez legfeljebb {MaxFilesPerMessage} fájlt lehet csatolni, " +
                             $"ezért „{requested}” és az utána megadottak kimaradtak.");
                break;
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(Path.Combine(root, requested!));
            }
            catch (ArgumentException)
            {
                problems.Add($"A „{requested}” név nem értelmezhető fájlútvonalként.");
                continue;
            }

            if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
            {
                problems.Add($"A „{requested}” a munkamappádon kívülre mutat — csak a saját " +
                             "munkamappádban lévő fájlt küldhetsz.");
                continue;
            }

            var info = new FileInfo(fullPath);
            if (!info.Exists)
            {
                problems.Add($"Nincs „{requested}” nevű fájl a munkamappádban.");
                continue;
            }

            if (info.Length > MaxFileBytes)
            {
                problems.Add($"A „{requested}” nagyobb a megengedett {MaxFileBytes / (1024 * 1024)} MB-nál, " +
                             "ezért nem került elküldésre.");
                continue;
            }

            // A küldő-oldali nevet a megjelenítéshez őrizzük meg, a célnevet viszont lapítjuk:
            // a címzettnél a fájl a saját `_bejovo/<küldő>/` mappájába kerül, almappák nélkül.
            resolved.Add(new ChannelAttachment(fullPath, requested!, Path.GetFileName(fullPath)));
        }

        return (resolved, problems);
    }

    /// <summary>
    /// Átmásolja a mellékleteket a címzett munkamappájába, és visszaadja a NEKI szóló, munkamappához
    /// képesti relatív neveket — ezekből lesz a prompt `@` hivatkozása. A botok mappái el vannak
    /// különítve, ezért a másolás elkerülhetetlen: a címzett a küldő mappáját nem éri el.
    /// </summary>
    private static (List<string> Copied, string? Problem) CopyToRecipient(
        BotSession from, BotSession recipient, IReadOnlyList<ChannelAttachment> attachments)
    {
        var copied = new List<string>();
        if (attachments.Count == 0)
            return (copied, null);

        var targetDir = Path.Combine(recipient.FolderPath, IncomingFolderName, from.Name);

        try
        {
            Directory.CreateDirectory(targetDir);

            foreach (var attachment in attachments)
            {
                File.Copy(attachment.SourcePath, Path.Combine(targetDir, attachment.TargetFileName), overwrite: true);

                // A `@` hivatkozásban és a chat 📎 jelzésében is ez a relatív út jelenik meg; a
                // perjel szándékosan `/`, mert a claude.exe prompt-hivatkozásai ezt várják.
                copied.Add($"{IncomingFolderName}/{from.Name}/{attachment.TargetFileName}");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (copied, $"„{recipient.DisplayName}” munkamappájába nem sikerült átmásolni a " +
                            $"fájl(oka)t: {ex.Message}");
        }

        return (copied, null);
    }

    /// <summary>A kézbesített prompt. A fejléc és a záró útmutató azért kell, mert a címzett bot
    /// számára ez egy sima felhasználói kör: enélkül nem tudná, kitől jött, és hogy mivel
    /// válaszolhat. A fájlokról külön mondat szól: a prompt végére kerülő `@` hivatkozásokból
    /// magától nem derülne ki, hogy azokat egy másik bot küldte, és hogy szabadon használhatja őket.</summary>
    private static string FormatDelivery(ChannelMessage message, bool withFiles)
    {
        var fileNote = withFiles
            ? "A küldő fájlt is mellékelt: a másolatuk a te munkamappádban van, a prompt végi " +
              "`@` hivatkozások mutatnak rájuk."
            : "";

        var body = string.IsNullOrWhiteSpace(message.Text)
            ? fileNote
            : fileNote.Length == 0 ? message.Text : $"{message.Text}\n\n{fileNote}";

        return $"[Bot-csatorna] „{message.FromDisplayName}” üzenete:\n\n" +
               $"{body}\n\n" +
               $"— Ha válaszolsz, hívd az `mcp__{BotSession.ChannelMcpServerName}__send_message` tool-t a " +
               $"`to: [\"{message.FromBotId}\"]` paraméterrel. Ha a kérés nem rád tartozik, vagy nem tudsz " +
               "érdemben hozzátenni, nyugodtan hagyd figyelmen kívül — nem kötelező válaszolni.";
    }

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

/// <summary>Egy csatolmány a kiküldés közben: hol van a küldőnél, hogyan hivatkozott rá a küldő bot
/// (ez jelenik meg a felületen és a naplóban), és milyen néven kerül a címzett mappájába. A három
/// név azért válik szét, mert a küldő almappából is küldhet, a címzettnél viszont lapítva, egy
/// küldőnkénti mappában landol minden fájl.</summary>
internal sealed record ChannelAttachment(string SourcePath, string Name, string TargetFileName);
