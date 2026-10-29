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
    Thinking,
}

public readonly record struct LogLine(LogKind Kind, string Text);

public class BotSession
{
    public const string AgentFileName = "agent.md";
    public const string DebugLogFileName = "claudebot-stream.log";
    public const string DefaultPermissionMode = "acceptEdits";

    // Új bot ezzel indul, ha a Settings felületen még nem állított be egyedi listát —
    // minden MCP-szerver tool-ját engedi, a natív (Bash stb.) tool-okat szándékosan nem.
    public static readonly IReadOnlyList<string> DefaultAllowedTools = new[] { "mcp__*" };

    public string Name { get; private set; }
    public string FolderPath { get; private set; }
    public string DisplayName { get; set; }
    public List<string> AllowedTools { get; set; } = new(DefaultAllowedTools);
    public string? Model { get; set; }
    public string? Effort { get; set; }
    public string PermissionMode { get; set; } = DefaultPermissionMode;
    public List<ScheduledTask> ScheduledTasks { get; set; } = new();
    public List<LogLine> AccumulatedLog { get; } = new();
    public BotStatus Status { get; private set; } = BotStatus.Stopped;

    private Process? _process;

    public event Action<LogLine>? LogReceived;
    public event Action<BotStatus>? StatusChanged;

    /// <summary>Egy prompt feldolgozásának vége. Paraméterek: a <see cref="SendPrompt"/> által
    /// visszaadott prompt-uuid, és hogy hibával zárult-e. A claude.exe `result` eseményéből jön,
    /// amelynek `user_message_uuid` mezője visszamutat a kiváltó promptra (ld. ADR-0001).
    /// FIGYELEM: a folyamat kimenetét olvasó háttérszálon hívódik.</summary>
    public event Action<string, bool>? TurnCompleted;

    public BotSession(string name, string folderPath)
    {
        Name = name;
        FolderPath = folderPath;
        DisplayName = name;
    }

    /// <summary>A workspace-mappa átnevezése után hívandó — a BotSessionManager felelőssége a
    /// tényleges Directory.Move elvégzése, ez csak az in-memory állapotot frissíti utána.</summary>
    public void Rename(string newName, string newFolderPath)
    {
        Name = newName;
        FolderPath = newFolderPath;
    }

    public void Start()
    {
        var psi = new ProcessStartInfo
        {
            FileName = "claude.exe",
            WorkingDirectory = FolderPath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add("--input-format");
        psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--output-format");
        psi.ArgumentList.Add("stream-json");
        psi.ArgumentList.Add("--verbose");
        psi.ArgumentList.Add("--permission-mode");
        psi.ArgumentList.Add(string.IsNullOrWhiteSpace(PermissionMode) ? DefaultPermissionMode : PermissionMode);

        if (!string.IsNullOrWhiteSpace(Model))
        {
            psi.ArgumentList.Add("--model");
            psi.ArgumentList.Add(Model);
        }

        if (!string.IsNullOrWhiteSpace(Effort))
        {
            psi.ArgumentList.Add("--effort");
            psi.ArgumentList.Add(Effort);
        }

        // Headless (-p) módban nincs interaktív jóváhagyási csatorna: az acceptEdits csak a
        // fájlszerkesztő tool-okat engedi automatikusan, minden más (MCP-hívások, Bash stb.)
        // némán elutasításra kerülne jóváhagyás nélkül. Az AllowedTools-ot a Settings
        // felületen bot-onként lehet karbantartani (lásd BotSessionManager.ApplySettings).
        if (AllowedTools.Count > 0)
        {
            psi.ArgumentList.Add("--allowedTools");
            psi.ArgumentList.Add(string.Join(",", AllowedTools));
        }

        // Ha a workspace gyökerében van egy agent.md, a tartalma system prompt kiegészítésként
        // minden (új) indításkor újra átadódik.
        var agentFilePath = Path.Combine(FolderPath, AgentFileName);
        if (File.Exists(agentFilePath))
        {
            psi.ArgumentList.Add("--append-system-prompt");
            psi.ArgumentList.Add(File.ReadAllText(agentFilePath));
        }

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

    /// <summary>
    /// Promptot küld a bot session-jének. Visszaadja a prompt uuid-ját, amivel a befejezés
    /// (<see cref="TurnCompleted"/>) később azonosítható — vagy null-t, ha nem sikerült elküldeni.
    /// A <paramref name="taskName"/> megadásakor a prompt feladat-futásként jelenik meg a
    /// csevegésben (UC-013); ilyenkor a felhasználói üzenet is eseményt vált ki, mert a felület
    /// ezt — a kézi üzenetküldéssel ellentétben — nem jeleníti meg előre.
    /// </summary>
    public string? SendPrompt(string text, IReadOnlyList<string>? attachmentNames = null, string? taskName = null)
    {
        var hasAttachments = attachmentNames != null && attachmentNames.Count > 0;
        if (_process == null || _process.HasExited || (string.IsNullOrWhiteSpace(text) && !hasAttachments))
            return null;

        var promptText = text;
        var displayText = text;

        if (hasAttachments)
        {
            // A claude.exe-nek @fájlnév hivatkozást küldünk (a bot workspace-ében már lemenve várja).
            var fileRefs = string.Join(" ", attachmentNames!.Select(n => $"@{n}"));
            promptText = string.IsNullOrWhiteSpace(text) ? fileRefs : $"{text}\n\n{fileRefs}";

            // A history-ba ugyanaz a jelzés kerül, mint amit a React optimistán megjelenít,
            // hogy bot-váltás után is konzisztens maradjon a megjelenítés.
            var fileNote = $"📎 {string.Join(", ", attachmentNames!)}";
            displayText = string.IsNullOrWhiteSpace(text) ? fileNote : $"{text}\n\n{fileNote}";
        }

        var uuid = Guid.NewGuid().ToString();
        var payload = new
        {
            uuid,
            session_id = "",
            type = "user",
            parent_tool_use_id = (string?)null,
            message = new { content = promptText, role = "user" }
        };

        try
        {
            var json = JsonSerializer.Serialize(payload);
            LogDebug(">>", json);
            _process.StandardInput.WriteLine(json);

            if (taskName != null)
            {
                // Feladat-futás: a felület nem jelenítette meg előre, ezért eseményt is dobunk.
                RaiseLog(LogKind.Info, $"⏱ Ütemezett feladat: {taskName}");
                RaiseLog(LogKind.User, displayText);
            }
            else
            {
                // Kézi üzenet: csak a history-ba kerül be (a kiválasztott bot React oldala már
                // optimistán megjelenítette) — nincs esemény-dobás, hogy ne duplikálódjon.
                AccumulatedLog.Add(new LogLine(LogKind.User, displayText));
            }

            // Azonnali, vizuális jelzés, hogy elindult a feldolgozás — a claude.exe tényleges
            // thinking/tool_use eseményei csak egy kis késéssel érkeznek meg.
            RaiseLog(LogKind.Thinking, "Gondolkodik…");
            return uuid;
        }
        catch (Exception ex)
        {
            RaiseLog(LogKind.Error, $"prompt küldése sikertelen: {ex.Message}");
            return null;
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

    /// <summary>
    /// Azonnali, teljes leállítás a bot törléséhez: a claude.exe-t és a GYERMEKFOLYAMATAIT is
    /// (MCP-szerverek) kilövi, majd megvárja a kilépést. A sima <see cref="Stop"/> csak a
    /// stdin lezárásával kér kilépést, és a gyermekek ettől még másodpercekig életben
    /// maradhatnak — mivel a munkakönyvtáruk a bot mappája, addig az nem törölhető.
    /// </summary>
    public void StopForDeletion()
    {
        if (_process == null)
            return;

        try
        {
            if (!_process.HasExited)
                _process.Kill(entireProcessTree: true);

            _process.WaitForExit(5000);
        }
        catch
        {
            // a leállítás közbeni hibák nem akadályozhatják a törlést
        }
    }

    public void Restart()
    {
        Stop();
        Start();
    }

    private void OnOutputDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data))
            return;

        LogDebug("<<", e.Data);

        try
        {
            using var doc = JsonDocument.Parse(e.Data);
            TryRaiseTurnCompleted(doc.RootElement);
            foreach (var (kind, text) in ExtractLogEntries(doc.RootElement))
            {
                RaiseLog(kind, text);
            }
        }
        catch (JsonException)
        {
            RaiseLog(LogKind.Info, e.Data);
        }
    }

    // Egy "assistant" típusú stream-json sorból több log-bejegyzés is származhat: a végleges
    // válasz-szöveg (type: text) egyetlen Assistant-buborékká áll össze, míg a köztes
    // gondolkodás (type: thinking) és eszközhívások (type: tool_use) Thinking-sorokként,
    // érkezési sorrendben kerülnek ki — ezekből építi fel a UI az összecsukható "gondolkodás" blokkot.
    private static IEnumerable<(LogKind Kind, string Text)> ExtractLogEntries(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeProp) || typeProp.GetString() != "assistant")
            yield break;

        if (!root.TryGetProperty("message", out var message) ||
            !message.TryGetProperty("content", out var content) ||
            content.ValueKind != JsonValueKind.Array)
            yield break;

        var textBuilder = new StringBuilder();

        foreach (var item in content.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("type", out var itemTypeProp))
                continue;

            switch (itemTypeProp.GetString())
            {
                case "text":
                    if (item.TryGetProperty("text", out var textProp))
                        textBuilder.Append(textProp.GetString());
                    break;

                case "thinking":
                    if (item.TryGetProperty("thinking", out var thinkingProp))
                    {
                        var thinkingText = thinkingProp.GetString();
                        if (!string.IsNullOrWhiteSpace(thinkingText))
                            yield return (LogKind.Thinking, thinkingText);
                    }
                    break;

                case "tool_use":
                    yield return (LogKind.Thinking, DescribeToolUse(item));
                    break;
            }
        }

        if (textBuilder.Length > 0)
            yield return (LogKind.Assistant, textBuilder.ToString());
    }

    private static string DescribeToolUse(JsonElement toolUseItem)
    {
        var name = toolUseItem.TryGetProperty("name", out var nameProp) ? nameProp.GetString() : null;
        var label = string.IsNullOrWhiteSpace(name) ? "eszköz" : name;

        string? detail = null;
        if (toolUseItem.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in input.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.String)
                {
                    detail = prop.Value.GetString();
                    break;
                }
            }
        }

        return detail != null ? $"🔧 {label}: {detail}" : $"🔧 {label}";
    }

    /// <summary>A kör végét jelző `result` eseményből váltja ki a <see cref="TurnCompleted"/>-et.
    /// A `user_message_uuid` köti a befejezést a kiváltó prompthoz, így a chat-üzenetek és a
    /// feladat-futások nem keverednek össze.</summary>
    private void TryRaiseTurnCompleted(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeProp) || typeProp.GetString() != "result")
            return;

        if (!root.TryGetProperty("user_message_uuid", out var uuidProp))
            return;

        var uuid = uuidProp.GetString();
        if (string.IsNullOrEmpty(uuid))
            return;

        var isError = root.TryGetProperty("is_error", out var errorProp) &&
                      errorProp.ValueKind == JsonValueKind.True;

        TurnCompleted?.Invoke(uuid, isError);
    }

    private void OnErrorDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data))
            return;

        LogDebug("!!", e.Data);
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

    // Minden nyers stream-json sor (ki- és bemenet is) egy fájlba kerül a bot workspace-ében —
    // ez teszi lehetővé, hogy diagnosztizálni lehessen, pontosan mit küld a claude.exe olyan
    // esetekben (pl. tool-engedélyezési kérés), amiket a UI még nem jelenít meg strukturáltan.
    private void LogDebug(string direction, string text)
    {
        try
        {
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] {direction} {text}{Environment.NewLine}";
            File.AppendAllText(Path.Combine(FolderPath, DebugLogFileName), line);
        }
        catch
        {
            // a debug napló írása sosem akadályozhatja a tényleges működést
        }
    }

    private void SetStatus(BotStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(status);
    }
}
