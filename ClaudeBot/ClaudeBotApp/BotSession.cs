using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace ClaudeBotApp;

public enum BotStatus
{
    Running,
    Stopped,
    Error,
}

public enum LogKind
{
    Assistant,
    Info,
    Error,
    User,
}

public readonly record struct LogLine(LogKind Kind, string Text);

public class BotSession
{
    public string Name { get; }
    public string FolderPath { get; }
    public List<LogLine> AccumulatedLog { get; } = new();
    public BotStatus Status { get; private set; } = BotStatus.Stopped;

    private Process? _process;

    public event Action<LogLine>? LogReceived;
    public event Action<BotStatus>? StatusChanged;

    public BotSession(string name, string folderPath)
    {
        Name = name;
        FolderPath = folderPath;
    }

    public void Start()
    {
        var psi = new ProcessStartInfo
        {
            FileName = "claude.exe",
            Arguments = "-p --input-format stream-json --output-format stream-json --verbose --permission-mode acceptEdits",
            WorkingDirectory = FolderPath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _process.OutputDataReceived += OnOutputDataReceived;
        _process.ErrorDataReceived += OnErrorDataReceived;
        _process.Exited += OnExited;

        try
        {
            _process.Start();
            _process.StandardInput.AutoFlush = true;
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();
            SetStatus(BotStatus.Running);
        }
        catch (Exception ex)
        {
            SetStatus(BotStatus.Error);
            RaiseLog(LogKind.Error, $"claude.exe indítása sikertelen: {ex.Message}");
        }
    }

    public void SendPrompt(string text)
    {
        if (_process == null || _process.HasExited || string.IsNullOrWhiteSpace(text))
            return;

        var payload = new
        {
            uuid = Guid.NewGuid().ToString(),
            session_id = "",
            type = "user",
            parent_tool_use_id = (string?)null,
            message = new { content = text, role = "user" }
        };

        try
        {
            var json = JsonSerializer.Serialize(payload);
            _process.StandardInput.WriteLine(json);

            // Csak a history-ba kerül be (a kiválasztott bot React oldala már optimistán
            // megjelenítette a saját üzenetét) — nincs esemény-dobás, hogy ne duplikálódjon.
            AccumulatedLog.Add(new LogLine(LogKind.User, text));
        }
        catch (Exception ex)
        {
            RaiseLog(LogKind.Error, $"prompt küldése sikertelen: {ex.Message}");
        }
    }

    public void Stop()
    {
        if (_process == null)
            return;

        try
        {
            if (!_process.HasExited)
            {
                _process.StandardInput.Close();
                if (!_process.WaitForExit(3000))
                {
                    _process.Kill();
                }
            }
        }
        catch
        {
            // a folyamat leállítása közben fellépő hibák nem akadályozhatják az app bezárását
        }
    }

    private void OnOutputDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data))
            return;

        string? text;
        try
        {
            using var doc = JsonDocument.Parse(e.Data);
            text = ExtractAssistantText(doc.RootElement);
        }
        catch (JsonException)
        {
            text = e.Data;
        }

        if (!string.IsNullOrEmpty(text))
        {
            RaiseLog(LogKind.Assistant, text);
        }
    }

    private static string? ExtractAssistantText(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeProp) || typeProp.GetString() != "assistant")
            return null;

        if (!root.TryGetProperty("message", out var message) ||
            !message.TryGetProperty("content", out var content))
            return null;

        var sb = new StringBuilder();
        if (content.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in content.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object &&
                    item.TryGetProperty("type", out var itemType) &&
                    itemType.GetString() == "text" &&
                    item.TryGetProperty("text", out var textProp))
                {
                    sb.Append(textProp.GetString());
                }
            }
        }
        else if (content.ValueKind == JsonValueKind.String)
        {
            sb.Append(content.GetString());
        }

        return sb.Length > 0 ? sb.ToString() : null;
    }

    private void OnErrorDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data))
            return;

        RaiseLog(LogKind.Error, e.Data);
    }

    private void OnExited(object? sender, EventArgs e)
    {
        SetStatus(BotStatus.Stopped);
        RaiseLog(LogKind.Info, "A claude.exe folyamat leállt.");
    }

    private void RaiseLog(LogKind kind, string text)
    {
        var line = new LogLine(kind, text);
        AccumulatedLog.Add(line);
        LogReceived?.Invoke(line);
    }

    private void SetStatus(BotStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(status);
    }
}
