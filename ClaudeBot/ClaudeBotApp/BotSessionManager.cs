using System.Diagnostics;

namespace ClaudeBotApp;

public class BotSessionManager
{
    private readonly string _rootDir;
    private readonly List<BotSession> _bots = new();

    public event Action? BotListChanged;
    public event Action<BotSession, LogLine>? LogReceived;
    public event Action<BotSession, BotStatus>? BotStatusChanged;

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
        AddBot(name, folderPath);
        return (true, null);
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

    private void AddBot(string name, string folderPath)
    {
        var bot = new BotSession(name, folderPath);
        bot.LogReceived += line => LogReceived?.Invoke(bot, line);
        bot.StatusChanged += status => BotStatusChanged?.Invoke(bot, status);
        _bots.Add(bot);

        bot.Start();
        BotListChanged?.Invoke();
    }
}
