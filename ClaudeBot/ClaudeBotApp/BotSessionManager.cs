using System.Diagnostics;
using System.Text.Json;

namespace ClaudeBotApp;

public class BotSessionManager
{
    private const string InitialOnboardingPrompt =
        "Indítsd el a /grill-me skillt, és faggass ki alaposan arról, mi legyen ennek az agentnek " +
        "a szerepe, célja és működési stílusa. A beszélgetés végén foglald össze a válaszaimat egy " +
        "agent.md fájlba ennek a munkamappának a gyökerében — ez a fájl fogja meghatározni a " +
        "jövőbeli indításaid system promptját.";

    private readonly string _rootDir;
    private readonly string _templateDir;
    private readonly List<BotSession> _bots = new();

    public event Action? BotListChanged;
    public event Action<BotSession, LogLine>? LogReceived;
    public event Action<BotSession, BotStatus>? BotStatusChanged;

    public IReadOnlyList<BotSession> Bots => _bots;

    public BotSessionManager(string rootDir, string templateDir)
    {
        _rootDir = rootDir;
        _templateDir = templateDir;
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
        CopyTemplate(folderPath);

        var bot = AddBot(name, folderPath);
        bot.SendPrompt(InitialOnboardingPrompt);
        return (true, null);
    }

    public void RestartBot(string id)
    {
        FindBot(id)?.Restart();
    }

    private void CopyTemplate(string destFolder)
    {
        if (!Directory.Exists(_templateDir))
            return;

        foreach (var dir in Directory.GetDirectories(_templateDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(_templateDir, dir);
            Directory.CreateDirectory(Path.Combine(destFolder, relative));
        }

        foreach (var file in Directory.GetFiles(_templateDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(_templateDir, file);
            File.Copy(file, Path.Combine(destFolder, relative), overwrite: true);
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

    public (bool success, string? error) SetDisplayName(string id, string newDisplayName)
    {
        var bot = FindBot(id);
        if (bot == null)
            return (false, "A bot nem található.");

        var trimmed = newDisplayName.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return (false, "A név nem lehet üres.");

        bot.DisplayName = trimmed;
        SaveMeta(bot);
        BotListChanged?.Invoke();
        return (true, null);
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
            var meta = JsonSerializer.Deserialize<BotMeta>(File.ReadAllText(path));
            if (!string.IsNullOrWhiteSpace(meta?.DisplayName))
            {
                bot.DisplayName = meta.DisplayName;
            }
        }
        catch (JsonException)
        {
            // sérült meta-fájl — az alapértelmezett (mappanév) DisplayName marad érvényben
        }
    }

    private static void SaveMeta(BotSession bot)
    {
        var meta = new BotMeta { DisplayName = bot.DisplayName };
        File.WriteAllText(GetMetaPath(bot), JsonSerializer.Serialize(meta));
    }

    private sealed class BotMeta
    {
        public string? DisplayName { get; set; }
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
        LoadMeta(bot);
        _bots.Add(bot);

        bot.Start();
        BotListChanged?.Invoke();
        return bot;
    }
}
