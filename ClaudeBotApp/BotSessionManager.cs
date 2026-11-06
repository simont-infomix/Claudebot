using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClaudeBotApp;

/// <summary>Egy skill vagy sub agent neve és a SKILL.md/agent .md frontmatterjéből kiolvasott
/// rövid leírása — a "Képességek" tab chipjeinek tooltipjéhez. A <see cref="Shared"/> mondja meg,
/// hogy a `Bots/.claude/` közös mappából származik-e (minden bot látja), vagy az adott bot saját
/// workspace-éből.</summary>
public record CapabilityInfo(string Name, string? Description, bool Shared);

public class BotSessionManager
{
    /// <summary>Az enumokat szövegként írjuk a .bot-meta.json-ba, hogy a mentett ütemezés kézzel
    /// is olvasható/diagnosztizálható maradjon, ne nyers számként jelenjen meg.</summary>
    private static readonly JsonSerializerOptions MetaJsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() },
        WriteIndented = true,
    };

    private readonly string _rootDir;
    private readonly List<BotSession> _bots = new();

    /// <summary>A bot-csatorna MCP szerverének gyökér-címe (ADR-0005), vagy null, ha a szerver nem
    /// indult el — ilyenkor a botok csatorna-tool-ok nélkül futnak.</summary>
    private readonly string? _channelBaseUrl;

    /// <summary>Csatorna-token → bot. A token adja a bot kilétét az MCP-híváskor, ezért
    /// kitalálhatatlannak kell lennie, és csak memóriában él (lemezre sosem kerül). A kulcs
    /// szándékosan a token, nem a bot neve: így az átnevezés magától helyes marad.
    /// Konkurens gyűjtemény, mert a feloldás a Kestrel kérés-szálairól jön, a bővítés/törlés
    /// viszont a UI-szálról.</summary>
    private readonly ConcurrentDictionary<string, BotSession> _channelTokens = new();

    /// <summary>A botok feladatlistájának cseréjét sorosítja. A botok a saját MCP-hívásuk szálán
    /// módosíthatják a feladataikat (UC-022), a felület és a scheduler viszont a UI-szálról
    /// olvassa ugyanezeket a listákat.</summary>
    private readonly object _taskGate = new();

    public event Action? BotListChanged;
    public event Action<BotSession, LogLine>? LogReceived;
    public event Action<BotSession, BotStatus>? BotStatusChanged;

    /// <summary>Egy prompt feldolgozása befejeződött. A scheduler ebből tudja meg, hogy egy
    /// feladat-futás véget ért. Háttérszálon hívódik (ld. <see cref="BotSession.TurnCompleted"/>).</summary>
    public event Action<BotSession, TurnResult>? TurnCompleted;

    /// <summary>Egy bot tool-jóváhagyást kér (UC-018). Háttérszálon hívódik.</summary>
    public event Action<BotSession, PermissionRequest>? PermissionRequested;

    /// <summary>Egy jóváhagyási kérés lezárult (válasz, lejárat vagy a folyamat leállása).</summary>
    public event Action<BotSession, PermissionRequest>? PermissionResolved;

    public IReadOnlyList<BotSession> Bots => _bots;

    public BotSessionManager(string rootDir, string? channelBaseUrl = null)
    {
        _rootDir = rootDir;
        _channelBaseUrl = channelBaseUrl;
    }

    /// <summary>A csatorna-token feloldása bot-session-re (ADR-0005) — ezt hívja a
    /// <see cref="ChannelMcpServer"/> middleware-e minden bejövő MCP-kérésnél.</summary>
    public BotSession? ResolveByChannelToken(string token) =>
        _channelTokens.TryGetValue(token, out var bot) ? bot : null;

    public void LoadExisting()
    {
        Directory.CreateDirectory(_rootDir);

        foreach (var dir in Directory.GetDirectories(_rootDir).OrderBy(d => d))
        {
            var name = Path.GetFileName(dir);

            // A "."-tal kezdődő mappák (pl. .claude/) nem botok — ide kerülnek a minden bot
            // között megosztott skill-ek és sub agent-ek (ld. GetBotDetails), amiket a claude.exe
            // a munkakönyvtárból felfelé haladva magától felvesz (BUG-006).
            if (name.StartsWith('.'))
                continue;

            AddBot(name, dir);
        }
    }

    public BotSession? FindBot(string name) => _bots.FirstOrDefault(b => b.Name == name);

    public (bool success, string? error) CreateBot(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return (false, "A bot neve nem lehet üres.");

        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            return (false, "A név nem tartalmazhat érvénytelen fájlnév-karaktert.");

        var folderPath = Path.Combine(_rootDir, name);
        if (Directory.Exists(folderPath))
            return (false, "Már létezik ilyen nevű bot.");

        Directory.CreateDirectory(folderPath);

        var bot = AddBot(name, folderPath);
        SaveMeta(bot);
        return (true, null);
    }

    public void RestartBot(string id)
    {
        FindBot(id)?.Restart();
    }

    /// <summary>
    /// Véglegesen törli a botot: leállítja a session-jét, majd törli a teljes workspace-mappáját.
    /// Visszafordíthatatlan — a hívó felelőssége a megerősítés bekérése (UC-016).
    ///
    /// A sorrend kötött: a claude.exe munkakönyvtára maga a bot mappája, és Windows alatt egy
    /// futó folyamat aktuális könyvtára zárolja azt — ezért előbb a folyamatot kell leállítani.
    /// A listából csak sikeres törlés után vesszük ki, hogy hiba esetén ne maradjon "eltűnt, de
    /// valójában létező" bot.
    /// </summary>
    public (bool success, string? error) DeleteBot(string id)
    {
        var bot = FindBot(id);
        if (bot == null)
            return (false, "A bot nem található.");

        bot.StopForDeletion();

        if (!TryDeleteDirectory(bot.FolderPath, out var error))
        {
            // A leggyakoribb ok, hogy valami kívülről fogja a mappát — tipikusan a bothoz
            // nyitott terminál (ld. BUG-001: az nem áll le az apppal együtt). Nem próbálunk
            // trükközni (átnevezés, félretevés): egyértelműen megmondjuk, mit kell kézzel
            // tennie a felhasználónak, a bot pedig a listában marad.
            return (false,
                $"A(z) \"{bot.Name}\" bot mappáját nem sikerült törölni, mert egy másik " +
                $"program használja. Zárj be minden hozzá tartozó ablakot (pl. terminált), " +
                $"töröld manuálisan a mappát ({bot.FolderPath}), majd indítsd újra a programot. " +
                $"(Részletek: {error})");
        }

        _bots.Remove(bot);

        // A csatorna-token nélkül a törölt bot végpontja azonnal érvénytelenné válik — egy még
        // futó gyermekfolyamat se tudjon a nevében üzenni.
        foreach (var token in _channelTokens.Where(kvp => kvp.Value == bot).Select(kvp => kvp.Key).ToList())
            _channelTokens.TryRemove(token, out _);

        BotListChanged?.Invoke();
        return (true, null);
    }

    /// <summary>
    /// A folyamatfa kilövése után a mappa méréseink szerint ~200 ms-on belül törölhető, de a
    /// fogók felszabadulása nem azonnali és nem garantált idejű — ezért néhány másodpercig
    /// újrapróbálkozunk, mielőtt hibát jelentenénk. (Finom leállítással, a gyermek MCP-folyamatok
    /// kilövése nélkül ez több másodperc is lehet, ld. BotSession.StopForDeletion.)
    /// </summary>
    private static bool TryDeleteDirectory(string path, out string? error)
    {
        const int attempts = 10;
        error = null;

        for (var i = 0; i < attempts; i++)
        {
            try
            {
                if (!Directory.Exists(path))
                    return true;

                Directory.Delete(path, recursive: true);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;

                if (i < attempts - 1)
                    Thread.Sleep(300);
            }
        }

        return false;
    }

    /// <summary>A bot konfigurációjának lemezre mentése és a felület értesítése. A scheduler
    /// hívja, miután egy feladat futási állapota (utolsó/következő futás) megváltozott.</summary>
    public void PersistBot(BotSession bot)
    {
        SaveMeta(bot);
        BotListChanged?.Invoke();
    }

    /// <summary>
    /// Új ütemezett feladat felvétele a bot saját kérésére (UC-022). A lista nem helyben bővül,
    /// hanem kicserélődik: a felvétel a bot MCP-hívásának szálán fut, míg a scheduler és a felület
    /// a UI-szálon olvassa ugyanezt a listát. Egy helyben módosított gyűjtemény ilyenkor
    /// kivételt dobhatna az olvasó oldalon, a referencia-csere viszont atomi — az olvasó vagy a
    /// régi, vagy az új listát látja, félkész állapotot soha.
    /// </summary>
    public void AddScheduledTask(BotSession bot, ScheduledTask task)
    {
        lock (_taskGate)
        {
            bot.ScheduledTasks = new List<ScheduledTask>(bot.ScheduledTasks) { task };
        }

        PersistBot(bot);
    }

    /// <summary>
    /// Meglévő feladat módosítása azonosító alapján, a bot saját kérésére (UC-022). Hamis
    /// visszatérés = nincs ilyen azonosítójú feladata. A <paramref name="apply"/> a zároláson
    /// belül fut, így két egyidejű módosítás nem írhatja felül egymást.
    /// </summary>
    public bool UpdateScheduledTask(BotSession bot, string taskId, Action<ScheduledTask> apply)
    {
        lock (_taskGate)
        {
            var updated = new List<ScheduledTask>(bot.ScheduledTasks);
            var task = updated.FirstOrDefault(t => t.Id == taskId);
            if (task == null)
                return false;

            apply(task);
            bot.ScheduledTasks = updated;
        }

        PersistBot(bot);
        return true;
    }

    /// <summary>
    /// Válasz egy tool-jóváhagyási kérésre (UC-018). "Mindig engedélyezd" esetén az eszköz
    /// tartósan felkerül a bot engedélyezett listájára is.
    /// Szándékosan NEM az <see cref="ApplySettings"/>-en keresztül: annak újraindítás-logikája
    /// az AllowedTools bármely változására újraindítaná a botot, ami épp a futó kör (és a
    /// beszélgetés kontextusának) elvesztését jelentené. Az új listát a claude.exe úgyis csak a
    /// következő induláskor olvassa — a futó folyamatra a válaszba csomagolt session-szabály hat.
    /// </summary>
    public bool RespondToPermission(string botId, string requestId, PermissionDecision decision)
    {
        var bot = FindBot(botId);
        if (bot == null)
            return false;

        if (decision == PermissionDecision.AllowedAlways)
        {
            var toolName = bot.PendingPermissions.FirstOrDefault(r => r.RequestId == requestId)?.ToolName;
            if (!string.IsNullOrWhiteSpace(toolName) && !bot.AllowedTools.Contains(toolName))
            {
                bot.AllowedTools.Add(toolName);
                PersistBot(bot);
            }
        }

        return bot.RespondToPermission(requestId, decision);
    }

    /// <summary>Válasz egy bot AskUserQuestion-kérdésére (UC-020).</summary>
    public bool AnswerUserQuestion(string botId, string requestId, IReadOnlyDictionary<string, IReadOnlyList<string>> answers)
    {
        var bot = FindBot(botId);
        return bot != null && bot.AnswerUserQuestion(requestId, answers);
    }

    /// <summary>A felhasználó explicit kihagyja a bot kérdését (UC-020).</summary>
    public bool SkipUserQuestion(string botId, string requestId)
    {
        var bot = FindBot(botId);
        return bot != null && bot.SkipUserQuestion(requestId);
    }

    /// <summary>Induláskor minden aktív feladathoz kiszámolja a következő futást, ha még nincs
    /// (új feladat, vagy korábban szüneteltetett volt). A már beütemezett — akár múltbeli —
    /// időpontokat szándékosan érintetlenül hagyja, mert a kimaradt futások pótlásáról a
    /// scheduler dönt a saját küszöbe alapján (ADR-0001).</summary>
    public void InitializeTaskSchedules()
    {
        var now = DateTime.Now;

        foreach (var bot in _bots)
        {
            var changed = false;

            foreach (var task in bot.ScheduledTasks)
            {
                if (!task.Enabled)
                {
                    if (task.NextRunAt == null)
                        continue;

                    task.NextRunAt = null;
                    changed = true;
                    continue;
                }

                if (task.NextRunAt != null)
                    continue;

                task.NextRunAt = TaskScheduleCalculator.ComputeNextRun(task.Schedule, now);
                changed = true;
            }

            if (changed)
                SaveMeta(bot);
        }
    }

    public void SendPrompt(string name, string text, IReadOnlyList<string>? attachmentNames = null)
    {
        FindBot(name)?.SendPrompt(text, attachmentNames);
    }

    /// <summary>Base64-tartalmat ment le fájlba a bot workspace-ébe. A fájlnevet Path.GetFileName-nel
    /// tisztítjuk, hogy a kliens oldalról érkező elérési út ne mutathasson a mappán kívülre.
    /// Visszaadja a ténylegesen elmentett fájlnevet, vagy null-t, ha a bot nem található.</summary>
    public string? SaveAttachment(string botName, string fileName, string base64Data)
    {
        var bot = FindBot(botName);
        if (bot == null)
            return null;

        var safeName = Path.GetFileName(fileName);
        if (string.IsNullOrWhiteSpace(safeName))
            return null;

        var bytes = Convert.FromBase64String(base64Data);
        var fullPath = Path.Combine(bot.FolderPath, safeName);
        File.WriteAllBytes(fullPath, bytes);

        return safeName;
    }

    /// <summary>A Settings lap "Mentés" gombja ezt hívja: elmenti a név/tool-engedélyek/model/
    /// effort/permission-mode mezőket, és újraindítja a bot session-t, mert a claude.exe csak
    /// induláskor olvassa ezeket — élő folyamaton egyik sem módosítható. Ha a név megváltozott,
    /// előtte leállítja a futó folyamatot és átnevezi a workspace-mappát is, mert a bot neve és a
    /// mappaneve mindig megegyezik. Sikeres átnevezés esetén newId-ban visszaadja az új
    /// azonosítót, hogy a UI követni tudja a kijelölést.</summary>
    public (bool success, string? error, string? newId) ApplySettings(
        string id, string newName, IReadOnlyList<string> allowedTools,
        string? model, string? effort, string? permissionMode, bool interactiveApproval,
        bool channelEnabled, IReadOnlyList<ScheduledTask> scheduledTasks)
    {
        var bot = FindBot(id);
        if (bot == null)
            return (false, "A bot nem található.", null);

        var trimmedName = newName.Trim();
        if (string.IsNullOrWhiteSpace(trimmedName))
            return (false, "A név nem lehet üres.", null);

        if (trimmedName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            return (false, "A név nem tartalmazhat érvénytelen fájlnév-karaktert.", null);

        string? newId = null;
        if (trimmedName != bot.Name)
        {
            var newFolderPath = Path.Combine(_rootDir, trimmedName);
            if (Directory.Exists(newFolderPath))
                return (false, "Már létezik ilyen nevű bot.", null);

            bot.Stop();
            Directory.Move(bot.FolderPath, newFolderPath);
            bot.Rename(trimmedName, newFolderPath);
            newId = trimmedName;
        }

        var newAllowedTools = allowedTools
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .Distinct()
            .ToList();
        var newModel = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
        var newEffort = string.IsNullOrWhiteSpace(effort) ? null : effort.Trim();
        var newPermissionMode = BotSession.NormalizePermissionMode(permissionMode);

        // A claude.exe ezeket csak induláskor olvassa, ezért változásuk újraindítást igényel —
        // a feladatlista és a csatorna-részvétel viszont nem: azokat a scheduler, illetve a
        // BotMessageBus futásidőben használja. Enélkül egy feladat szüneteltetése vagy a csatorna
        // kikapcsolása is eldobná a bot beszélgetés-kontextusát.
        var needsRestart =
            newId != null ||
            bot.Model != newModel ||
            bot.Effort != newEffort ||
            bot.PermissionMode != newPermissionMode ||
            bot.InteractiveApproval != interactiveApproval ||
            !bot.AllowedTools.SequenceEqual(newAllowedTools);

        bot.DisplayName = trimmedName;
        bot.AllowedTools = newAllowedTools;
        bot.Model = newModel;
        bot.Effort = newEffort;
        bot.PermissionMode = newPermissionMode;
        bot.InteractiveApproval = interactiveApproval;
        bot.ChannelEnabled = channelEnabled;
        bot.ScheduledTasks = MergeScheduledTasks(bot.ScheduledTasks, scheduledTasks);

        SaveMeta(bot);

        if (needsRestart)
            bot.Restart();

        BotListChanged?.Invoke();
        return (true, null, newId);
    }

    /// <summary>A "Bot definíció" és "Képességek" tab tartalmát adja vissza: az agent.md nyers
    /// szövege (ha van), illetve a workspace .claude/skills és .claude/agents mappáinak
    /// tartalomjegyzéke — mindegyikhez a SKILL.md/agent .md YAML frontmatterjéből kiolvasott
    /// rövid leírással, tooltiphez. A `Bots/.claude/` közös mappa tartalma is bekerül,
    /// `Shared = true` jelöléssel: a claude.exe a munkakönyvtárból felfelé haladva ezt is
    /// felveszi minden botnál (élesben mérve), tehát ez nem csak megjelenítés kedvéért közös,
    /// ténylegesen minden bot eléri. Csak olvasás — a skill-ek/sub agent-ek karbantartása még
    /// nincs megvalósítva a UI-n, ez egyelőre információs lista.</summary>
    public (string? agentDefinition, IReadOnlyList<CapabilityInfo> skills, IReadOnlyList<CapabilityInfo> subAgents) GetBotDetails(string id)
    {
        var bot = FindBot(id);
        if (bot == null)
            return (null, Array.Empty<CapabilityInfo>(), Array.Empty<CapabilityInfo>());

        var agentPath = Path.Combine(bot.FolderPath, BotSession.AgentFileName);
        var agentDefinition = File.Exists(agentPath) ? File.ReadAllText(agentPath) : null;

        var sharedClaudeDir = Path.Combine(_rootDir, ".claude");
        var botClaudeDir = Path.Combine(bot.FolderPath, ".claude");

        var skills = CollectSkills(Path.Combine(sharedClaudeDir, "skills"), shared: true)
            .Concat(CollectSkills(Path.Combine(botClaudeDir, "skills"), shared: false))
            .ToList();

        var subAgents = CollectSubAgents(Path.Combine(sharedClaudeDir, "agents"), shared: true)
            .Concat(CollectSubAgents(Path.Combine(botClaudeDir, "agents"), shared: false))
            .ToList();

        return (agentDefinition, skills, subAgents);
    }

    private static List<CapabilityInfo> CollectSkills(string skillsDir, bool shared)
    {
        if (!Directory.Exists(skillsDir))
            return new List<CapabilityInfo>();

        return Directory.GetDirectories(skillsDir)
            .Select(dir =>
            {
                var name = Path.GetFileName(dir);
                var description = ExtractFrontmatterDescription(Path.Combine(dir, "SKILL.md"));
                return new CapabilityInfo(name, description, shared);
            })
            .Where(c => !string.IsNullOrEmpty(c.Name))
            .OrderBy(c => c.Name)
            .ToList();
    }

    private static List<CapabilityInfo> CollectSubAgents(string agentsDir, bool shared)
    {
        if (!Directory.Exists(agentsDir))
            return new List<CapabilityInfo>();

        return Directory.GetFiles(agentsDir, "*.md")
            .Select(file => new CapabilityInfo(
                Path.GetFileNameWithoutExtension(file),
                ExtractFrontmatterDescription(file),
                shared))
            .Where(c => !string.IsNullOrEmpty(c.Name))
            .OrderBy(c => c.Name)
            .ToList();
    }

    /// <summary>Kiolvassa egy Markdown fájl YAML frontmatterjéből a "description:" mező értékét
    /// (egysoros formátum, opcionális idézőjelekkel) — teljes YAML-parsert nem igényel, mert a
    /// skill/agent fájlok konvencionálisan egyszerű, egysoros mezőket használnak.</summary>
    private static string? ExtractFrontmatterDescription(string filePath)
    {
        if (!File.Exists(filePath))
            return null;

        var lines = File.ReadAllLines(filePath);
        if (lines.Length == 0 || lines[0].Trim() != "---")
            return null;

        for (var i = 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line.Trim() == "---")
                break;

            if (!line.StartsWith("description:", StringComparison.Ordinal))
                continue;

            var value = line["description:".Length..].Trim();
            if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
            {
                value = value[1..^1];
            }
            return value.Length > 0 ? value : null;
        }

        return null;
    }

    /// <summary>
    /// A felületről érkező feladatlistát fésüli össze a meglévővel. A felület csak a DEFINÍCIÓS
    /// mezőket küldi vissza hitelesen; a futásidejű mezőket (utolsó/következő futás) a scheduler
    /// tartja karban, ezért azokat azonosító alapján a meglévő állapotból vesszük át. Enélkül egy
    /// nyitott Settings lapról történő mentés felülírná a közben lefutott feladat friss futási
    /// adatát (ld. ADR-0001).
    /// </summary>
    private static List<ScheduledTask> MergeScheduledTasks(
        IReadOnlyList<ScheduledTask> existing, IReadOnlyList<ScheduledTask> incoming)
    {
        var previousById = existing
            .GroupBy(t => t.Id)
            .ToDictionary(g => g.Key, g => g.First());

        var now = DateTime.Now;
        var merged = new List<ScheduledTask>();

        foreach (var task in incoming)
        {
            if (previousById.TryGetValue(task.Id, out var previous))
            {
                task.LastRun = previous.LastRun;
                task.NextRunAt = previous.NextRunAt;

                // Csak akkor számolunk újra, ha az ütemezés vagy az aktív állapot változott —
                // különben a már beütemezett időpont érvényben marad.
                var needsRecompute =
                    !SchedulesEqual(previous.Schedule, task.Schedule) || previous.Enabled != task.Enabled;

                if (needsRecompute)
                    task.NextRunAt = ComputeNextRunFor(task, now);
            }
            else
            {
                task.NextRunAt = ComputeNextRunFor(task, now);
            }

            merged.Add(task);
        }

        return merged;
    }

    /// <summary>Szüneteltetett feladatnak nincs esedékes futása (UC-012).</summary>
    private static DateTime? ComputeNextRunFor(ScheduledTask task, DateTime after) =>
        task.Enabled ? TaskScheduleCalculator.ComputeNextRun(task.Schedule, after) : null;

    private static bool SchedulesEqual(TaskSchedule a, TaskSchedule b) =>
        a.Type == b.Type &&
        a.IntervalMinutes == b.IntervalMinutes &&
        a.TimeOfDay == b.TimeOfDay &&
        SameInts(a.DaysOfWeek, b.DaysOfWeek) &&
        SameInts(a.DaysOfMonth, b.DaysOfMonth);

    private static bool SameInts(List<int>? a, List<int>? b)
    {
        if (a == null || b == null)
            return a == null && b == null;

        return a.Count == b.Count && a.OrderBy(x => x).SequenceEqual(b.OrderBy(x => x));
    }

    public void SetAvatar(string id, string contentType, string base64Data)
    {
        var bot = FindBot(id);
        if (bot == null)
            return;

        foreach (var oldFile in Directory.GetFiles(bot.FolderPath, ".bot-avatar.*"))
        {
            File.Delete(oldFile);
        }

        var bytes = Convert.FromBase64String(base64Data);
        var ext = ExtensionForContentType(contentType);
        File.WriteAllBytes(Path.Combine(bot.FolderPath, $".bot-avatar{ext}"), bytes);
        BotListChanged?.Invoke();
    }

    public string? GetAvatarDataUrl(string id)
    {
        var bot = FindBot(id);
        if (bot == null)
            return null;

        var file = Directory.GetFiles(bot.FolderPath, ".bot-avatar.*").FirstOrDefault();
        if (file == null)
            return null;

        var mime = ContentTypeForExtension(Path.GetExtension(file));
        var base64 = Convert.ToBase64String(File.ReadAllBytes(file));
        return $"data:{mime};base64,{base64}";
    }

    private static string ExtensionForContentType(string contentType) => contentType switch
    {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png",
    };

    private static string ContentTypeForExtension(string extension) => extension.TrimStart('.').ToLowerInvariant() switch
    {
        "jpg" or "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };

    private static string GetMetaPath(BotSession bot) => Path.Combine(bot.FolderPath, ".bot-meta.json");

    private static void LoadMeta(BotSession bot)
    {
        var path = GetMetaPath(bot);
        if (!File.Exists(path))
            return;

        try
        {
            var meta = JsonSerializer.Deserialize<BotMeta>(File.ReadAllText(path), MetaJsonOptions);
            if (!string.IsNullOrWhiteSpace(meta?.DisplayName))
            {
                bot.DisplayName = meta.DisplayName;
            }
            if (meta?.AllowedTools != null)
            {
                bot.AllowedTools = meta.AllowedTools;
            }
            bot.Model = meta?.Model;
            bot.Effort = meta?.Effort;
            if (!string.IsNullOrWhiteSpace(meta?.PermissionMode))
            {
                bot.PermissionMode = BotSession.NormalizePermissionMode(meta.PermissionMode);
            }
            if (meta?.InteractiveApproval != null)
            {
                bot.InteractiveApproval = meta.InteractiveApproval.Value;
            }
            if (meta?.ChannelEnabled != null)
            {
                bot.ChannelEnabled = meta.ChannelEnabled.Value;
            }
            if (meta?.ScheduledTasks != null)
            {
                bot.ScheduledTasks = meta.ScheduledTasks;
            }
        }
        catch (JsonException)
        {
            // sérült meta-fájl — az alapértelmezett (mappanév) DisplayName/AllowedTools marad érvényben
        }
    }

    private static void SaveMeta(BotSession bot)
    {
        // Törölt bot mappájába nem írunk vissza. Ez akkor fordulhat elő, ha a törlés pillanatában
        // még futott egy feladata: a befejezése háttérszálon érkezik, és mentést kezdeményezne
        // egy már nem létező mappába (ld. DeleteBot, BotTaskScheduler.OnTurnCompleted).
        if (!Directory.Exists(bot.FolderPath))
            return;

        var meta = new BotMeta
        {
            DisplayName = bot.DisplayName,
            AllowedTools = bot.AllowedTools,
            Model = bot.Model,
            Effort = bot.Effort,
            PermissionMode = bot.PermissionMode,
            InteractiveApproval = bot.InteractiveApproval,
            ChannelEnabled = bot.ChannelEnabled,
            ScheduledTasks = bot.ScheduledTasks,
        };
        File.WriteAllText(GetMetaPath(bot), JsonSerializer.Serialize(meta, MetaJsonOptions));
    }

    private sealed class BotMeta
    {
        public string? DisplayName { get; set; }
        public List<string>? AllowedTools { get; set; }
        public string? Model { get; set; }
        public string? Effort { get; set; }
        public string? PermissionMode { get; set; }

        /// <summary>Nullable, hogy a funkció bevezetése előtt mentett meta-fájlokban a hiánya
        /// megkülönböztethető legyen a szándékos kikapcsolástól — ilyenkor az alapértelmezés él.</summary>
        public bool? InteractiveApproval { get; set; }

        /// <summary>Részvétel a közös bot-csatornán (UC-021). Nullable, ld. az
        /// <see cref="InteractiveApproval"/> indoklását.</summary>
        public bool? ChannelEnabled { get; set; }

        public List<ScheduledTask>? ScheduledTasks { get; set; }
    }

    public void OpenTerminal(string name)
    {
        var bot = FindBot(name);
        if (bot == null)
            return;

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/K claude",
            WorkingDirectory = bot.FolderPath,
            UseShellExecute = true,
        };
        Process.Start(psi);
    }

    public void OpenWorkspaceFolder(string name)
    {
        var bot = FindBot(name);
        if (bot == null)
            return;

        var psi = new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{bot.FolderPath}\"",
            UseShellExecute = true,
        };
        Process.Start(psi);
    }

    public void StopAll()
    {
        foreach (var bot in _bots)
        {
            bot.Stop();
        }
    }

    private BotSession AddBot(string name, string folderPath)
    {
        var bot = new BotSession(name, folderPath);
        bot.LogReceived += line => LogReceived?.Invoke(bot, line);
        bot.StatusChanged += status => BotStatusChanged?.Invoke(bot, status);
        bot.TurnCompleted += result => TurnCompleted?.Invoke(bot, result);
        bot.PermissionRequested += request => PermissionRequested?.Invoke(bot, request);
        bot.PermissionResolved += request => PermissionResolved?.Invoke(bot, request);
        LoadMeta(bot);
        _bots.Add(bot);

        // A csatorna-végpontnak az indítás ELŐTT kell megvolnia: a claude.exe a --mcp-config-ot
        // csak induláskor olvassa (ld. BotSession.Start).
        if (_channelBaseUrl != null)
        {
            var token = Guid.NewGuid().ToString("N");
            _channelTokens[token] = bot;
            bot.ChannelMcpUrl = $"{_channelBaseUrl}/mcp/{token}";
        }

        bot.Start();
        BotListChanged?.Invoke();
        return bot;
    }
}
