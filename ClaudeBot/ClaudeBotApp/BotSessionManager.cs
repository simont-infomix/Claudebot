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

    public void SendPrompt(string name, string text)
    {
        FindBot(name)?.SendPrompt(text);
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
