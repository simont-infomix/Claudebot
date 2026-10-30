using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClaudeBotApp;

/// <summary>Egy skill vagy sub agent neve és a SKILL.md/agent .md frontmatterjéből kiolvasott
/// rövid leírása — a "Képességek" tab chipjeinek tooltipjéhez.</summary>
public record CapabilityInfo(string Name, string? Description);

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

    public BotSessionManager(string rootDir)
    {
        _rootDir = rootDir;
    }

    public void LoadExisting()
    {
        Directory.CreateDirectory(_rootDir);

        foreach (var dir in Directory.GetDirectories(_rootDir).OrderBy(d => d))
        {
            AddBot(Path.GetFileName(dir), dir);
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
        IReadOnlyList<ScheduledTask> scheduledTasks)
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
        var newPermissionMode = string.IsNullOrWhiteSpace(permissionMode)
            ? BotSession.DefaultPermissionMode
            : permissionMode.Trim();

        // A claude.exe ezeket csak induláskor olvassa, ezért változásuk újraindítást igényel —
        // a feladatlista viszont nem, azt a scheduler futásidőben használja. Enélkül egy feladat
        // szüneteltetése is eldobná a bot beszélgetés-kontextusát.
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
    /// rövid leírással, tooltiphez. Csak olvasás — a skill-ek/sub agent-ek karbantartása még
    /// nincs megvalósítva a UI-n, ez egyelőre információs lista.</summary>
    public (string? agentDefinition, IReadOnlyList<CapabilityInfo> skills, IReadOnlyList<CapabilityInfo> subAgents) GetBotDetails(string id)
    {
        var bot = FindBot(id);
        if (bot == null)
            return (null, Array.Empty<CapabilityInfo>(), Array.Empty<CapabilityInfo>());

        var agentPath = Path.Combine(bot.FolderPath, BotSession.AgentFileName);
        var agentDefinition = File.Exists(agentPath) ? File.ReadAllText(agentPath) : null;

        var skillsDir = Path.Combine(bot.FolderPath, ".claude", "skills");
        var skills = Directory.Exists(skillsDir)
            ? Directory.GetDirectories(skillsDir)
                .Select(dir =>
                {
                    var name = Path.GetFileName(dir);
                    var description = ExtractFrontmatterDescription(Path.Combine(dir, "SKILL.md"));
                    return new CapabilityInfo(name, description);
                })
                .Where(c => !string.IsNullOrEmpty(c.Name))
                .OrderBy(c => c.Name)
                .ToList()
            : new List<CapabilityInfo>();

        var agentsDir = Path.Combine(bot.FolderPath, ".claude", "agents");
        var subAgents = Directory.Exists(agentsDir)
            ? Directory.GetFiles(agentsDir, "*.md")
                .Select(file => new CapabilityInfo(
                    Path.GetFileNameWithoutExtension(file),
                    ExtractFrontmatterDescription(file)))
                .Where(c => !string.IsNullOrEmpty(c.Name))
                .OrderBy(c => c.Name)
                .ToList()
            : new List<CapabilityInfo>();

        return (agentDefinition, skills, subAgents);
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
                bot.PermissionMode = meta.PermissionMode;
            }
            if (meta?.InteractiveApproval != null)
            {
                bot.InteractiveApproval = meta.InteractiveApproval.Value;
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

        bot.Start();
        BotListChanged?.Invoke();
        return bot;
    }
}
