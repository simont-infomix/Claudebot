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

    /// <summary>Tool-jóváhagyási kérés helye a beszélgetés folyamában (UC-018). A sor szövege
    /// csak tartalék megjelenítés: az élő állapotot (gombok, döntés) a felület a
    /// <see cref="LogLine.RequestId"/> alapján, külön nyilvántartásból veszi.</summary>
    Permission,
}

/// <summary>A <paramref name="RequestId"/> csak <see cref="LogKind.Permission"/> sornál van
/// kitöltve — ez köti a chat-folyam adott pontját a jóváhagyási kéréshez, így a kártya a
/// helyén marad bot-váltás és a beszélgetés visszatöltése után is.</summary>
public readonly record struct LogLine(LogKind Kind, string Text, string? RequestId = null);

public class BotSession
{
    public const string AgentFileName = "agent.md";
    public const string DebugLogFileName = "claudebot-stream.log";
    public const string DefaultPermissionMode = "acceptEdits";

    /// <summary>Ennyit vár egy ütemezett feladat köréből érkező jóváhagyási kérés, mielőtt
    /// automatikusan elutasításra kerül — ilyenkor jellemzően nincs a gép előtt senki.</summary>
    public static readonly TimeSpan ScheduledApprovalTimeout = TimeSpan.FromMinutes(5);

    /// <summary>Kézi üzenetnél hosszabb a türelmi idő, de nem végtelen: a claude.exe a köröket
    /// sorosan dolgozza fel, ezért egy örökre válaszra váró kérés az adott bot MINDEN ütemezett
    /// feladatát is megbénítaná.</summary>
    public static readonly TimeSpan ManualApprovalTimeout = TimeSpan.FromMinutes(30);

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

    /// <summary>Kérdezzen-e a bot futásidőben engedélyt a nem engedélyezett eszközökre (UC-018).
    /// Kikapcsolva a korábbi viselkedés él: az ilyen hívások némán elutasításra kerülnek.</summary>
    public bool InteractiveApproval { get; set; } = true;

    public List<ScheduledTask> ScheduledTasks { get; set; } = new();
    public List<LogLine> AccumulatedLog { get; } = new();
    public BotStatus Status { get; private set; } = BotStatus.Stopped;

    /// <summary>Van-e olyan bot-válasz vagy hiba, amit a felhasználó még nem látott (UC-017).
    /// Kizárólag memóriában él — nem perzisztálódik, app-újraindítás után minden jelölő törlődik.
    /// Azt, hogy mikor számít egy üzenet "látottnak", a <see cref="WebViewBridge"/> dönti el (az
    /// ismeri az aktív nézetet és az ablak láthatóságát), ez a property csak az állapotot tárolja.</summary>
    public bool HasUnreadMessage { get; private set; }

    private Process? _process;

    /// <summary>A claude.exe stdin-jére TÖBB szálról is írunk (UI-szál: felhasználói válasz;
    /// időzítő-szál: lejárat miatti automatikus elutasítás; kimenet-olvasó szál: azonnali
    /// elutasítás), a StreamWriter viszont nem szálbiztos — lock nélkül két sor összekeveredhetne,
    /// amitől a CLI-vel való kommunikáció némán elromlana.</summary>
    private readonly object _stdinGate = new();

    /// <summary>A debug napló is több szálról íródik (`&gt;&gt;` az íróktól, `&lt;&lt;` az olvasó szálról);
    /// enélkül a párhuzamos File.AppendAllText megosztási hibát dobna, amit a catch elnyelne —
    /// épp a diagnosztika veszne el.</summary>
    private readonly object _logGate = new();

    /// <summary>Válaszra váró jóváhagyási kérések (requestId szerint). A gate alatt dől el, hogy
    /// egy kérés még Pending-e, és ugyanott áll át a döntése — így garantált, hogy egy
    /// request_id-ra pontosan egy válasz megy ki (dupla kattintás vagy válasz/lejárat verseny
    /// esetén is).</summary>
    private readonly Dictionary<string, PermissionRequest> _pending = new();
    private readonly object _permGate = new();
    private System.Threading.Timer? _expiryTimer;

    /// <summary>A még le nem zárt körök prompt-uuid-jai, küldési sorrendben. A control_request
    /// NEM hordoz prompt-azonosítót, csak tool_use_id-t, ezért a kérést a legrégebbi nyitott
    /// körhöz rendeljük. Átfedő körök (kézi üzenet ütemezett futás közben) esetén ez tévedhet —
    /// a tévedés ára egy rossz címke, illetve rossz feladathoz könyvelt sikertelenség.</summary>
    private readonly List<string> _activeTurns = new();

    /// <summary>Ütemezettként indított körök uuid-jai — a <see cref="PermissionRequest.IsScheduledRun"/>
    /// és a határidő ebből dől el.</summary>
    private readonly HashSet<string> _scheduledTurns = new();

    /// <summary>Körönként gyűjtött hibaok (pl. elutasított eszköz), amit a kör végén a
    /// <see cref="TurnResult"/> visz tovább a feladat-ütemezőnek.</summary>
    private readonly Dictionary<string, string> _turnFailureReason = new();
    private readonly object _turnGate = new();

    public event Action<LogLine>? LogReceived;
    public event Action<BotStatus>? StatusChanged;

    /// <summary>Új tool-jóváhagyási kérés érkezett (UC-018).
    /// FIGYELEM: a folyamat kimenetét olvasó háttérszálon hívódik.</summary>
    public event Action<PermissionRequest>? PermissionRequested;

    /// <summary>Egy jóváhagyási kérés lezárult (válasz, lejárat vagy a folyamat leállása miatt).</summary>
    public event Action<PermissionRequest>? PermissionResolved;

    /// <summary>Egy prompt feldolgozásának vége; a claude.exe `result` eseményéből jön, amelynek
    /// `user_message_uuid` mezője visszamutat a kiváltó promptra (ld. ADR-0001).
    /// FIGYELEM: a folyamat kimenetét olvasó háttérszálon hívódik.</summary>
    public event Action<TurnResult>? TurnCompleted;

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
        // Újraindításkor az előző folyamathoz tartozó kérés-azonosítók és nyitott körök
        // értelmüket vesztik — egy árván maradt kérésre később válaszolva a rossz (vagy egy
        // már nem létező) folyamatnak írnánk.
        CancelAllPendingPermissions("A bot újraindult, a jóváhagyási kérés érvénytelenné vált.");
        AbandonActiveTurns("A bot újraindult a kör közben.");

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

        // Az itt felsorolt tool-okra a bot nem kér külön engedélyt. Ami kimarad, arra az
        // InteractiveApproval dönt: vagy megkérdezi a felhasználót (UC-018), vagy — kikapcsolva —
        // némán elutasításra kerül. Az AllowedTools-ot a Settings felületen bot-onként lehet
        // karbantartani (lásd BotSessionManager.ApplySettings).
        if (AllowedTools.Count > 0)
        {
            psi.ArgumentList.Add("--allowedTools");
            psi.ArgumentList.Add(string.Join(",", AllowedTools));
        }

        // Ez kapcsolja be a kétirányú control-protokollt: a claude.exe a stdout-ra küld egy
        // can_use_tool kérést, és a stdin-en várja a döntést (ld. ADR-0004). Feltétele, hogy a
        // stdin VÉGIG nyitva maradjon — lezárt stdin mellett a CLI némán elutasít.
        if (InteractiveApproval)
        {
            psi.ArgumentList.Add("--permission-prompt-tool");
            psi.ArgumentList.Add("stdio");
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
            if (!WriteToProcess(JsonSerializer.Serialize(payload)))
                return null;

            lock (_turnGate)
            {
                _activeTurns.Add(uuid);
                if (taskName != null)
                    _scheduledTurns.Add(uuid);
            }

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

    /// <summary>true-ra állítja a jelzőt, ha korábban false volt. A visszatérési érték mondja meg
    /// a hívónak, hogy ténylegesen VÁLTOZOTT-e az állapot — erre épül, hogy a feliratkozóknak
    /// (bot-lista a sidebarnak, tálcaikon) csak akkor kell újra értesülniük.</summary>
    public bool MarkUnread()
    {
        if (HasUnreadMessage)
            return false;

        HasUnreadMessage = true;
        return true;
    }

    /// <summary>Lásd <see cref="MarkUnread"/> — ugyanaz a "csak változáskor jelez vissza" minta.</summary>
    public bool MarkSeen()
    {
        if (!HasUnreadMessage)
            return false;

        HasUnreadMessage = false;
        return true;
    }

    private void OnOutputDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data))
            return;

        LogDebug("<<", e.Data);

        try
        {
            using var doc = JsonDocument.Parse(e.Data);

            // A control-üzenetek nem a beszélgetés részei — ha ez a sor az volt, nem megy
            // tovább a log-kinyerésre.
            if (TryHandleControlMessage(doc.RootElement))
                return;

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

    /// <summary>A claude.exe kétirányú control-protokollja (ADR-0004). true, ha a sor
    /// control-üzenet volt (akkor is, ha nem tudtuk értelmezni) — ilyenkor a hívó nem
    /// dolgozza fel tovább.</summary>
    private bool TryHandleControlMessage(JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeProp))
            return false;

        var type = typeProp.GetString();

        // Mi nem küldünk control-kérést a CLI-nek, de ha mégis válasz érkezne, nem szabad a
        // csevegésbe kerülnie — a nyers sor a debug naplóban már ott van.
        if (type == "control_response" || type == "control_cancel_request")
            return true;

        if (type != "control_request")
            return false;

        var requestId = root.TryGetProperty("request_id", out var idProp) ? idProp.GetString() : null;
        if (string.IsNullOrEmpty(requestId) ||
            !root.TryGetProperty("request", out var request) ||
            request.ValueKind != JsonValueKind.Object)
        {
            return true;
        }

        var subtype = request.TryGetProperty("subtype", out var subProp) ? subProp.GetString() : null;
        if (subtype != "can_use_tool")
        {
            // Ismeretlen kérés: válasz nélkül a CLI beragadhatna, ezért hibát jelzünk vissza.
            SendControlError(requestId, $"unsupported control request subtype: {subtype}");
            return true;
        }

        CreatePendingRequest(requestId, request);
        return true;
    }

    private void CreatePendingRequest(string requestId, JsonElement request)
    {
        var toolName = request.TryGetProperty("tool_name", out var toolProp)
            ? toolProp.GetString() ?? "ismeretlen eszköz"
            : "ismeretlen eszköz";

        var inputJson = "{}";
        var summary = "";
        if (request.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Object)
        {
            inputJson = input.GetRawText();
            summary = SummarizeToolInput(input);
        }

        string? owningUuid;
        bool isScheduled;
        lock (_turnGate)
        {
            owningUuid = _activeTurns.Count > 0 ? _activeTurns[0] : null;
            isScheduled = owningUuid != null && _scheduledTurns.Contains(owningUuid);
        }

        var now = DateTime.Now;
        var permissionRequest = new PermissionRequest
        {
            RequestId = requestId,
            ToolName = toolName,
            InputSummary = summary,
            InputJson = inputJson,
            DecisionReason = request.TryGetProperty("decision_reason", out var reasonProp)
                ? reasonProp.GetString()
                : null,
            OwningPromptUuid = owningUuid,
            IsScheduledRun = isScheduled,
            CreatedAt = now,
            ExpiresAt = now + (isScheduled ? ScheduledApprovalTimeout : ManualApprovalTimeout),
        };

        lock (_permGate)
        {
            _pending[requestId] = permissionRequest;
        }

        EnsureExpiryTimer();

        // A chat-folyamba egy horgony-sor kerül: ez adja a kártya HELYÉT az időrendben, az élő
        // állapotát (gombok, döntés) viszont a felület a requestId alapján külön kapja meg.
        var label = string.IsNullOrWhiteSpace(summary) ? toolName : $"{toolName}: {summary}";
        RaiseLog(new LogLine(LogKind.Permission, $"🔐 Engedélyt kér — {label}", requestId));

        PermissionRequested?.Invoke(permissionRequest);
    }

    /// <summary>A kért művelet lényegét adó mező — a beszédes kulcsokat előnyben részesítve,
    /// mert az input első string mezője gyakran egy mellékes leírás.</summary>
    private static string SummarizeToolInput(JsonElement input)
    {
        foreach (var key in new[] { "command", "file_path", "path", "url", "pattern", "query", "prompt" })
        {
            if (input.TryGetProperty(key, out var preferred) && preferred.ValueKind == JsonValueKind.String)
            {
                var value = preferred.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                    return Shorten(value);
            }
        }

        foreach (var prop in input.EnumerateObject())
        {
            if (prop.Value.ValueKind == JsonValueKind.String)
            {
                var value = prop.Value.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                    return Shorten(value);
            }
        }

        return "";
    }

    private static string Shorten(string value)
    {
        var singleLine = value.ReplaceLineEndings(" ").Trim();
        return singleLine.Length > 300 ? singleLine[..300] + "…" : singleLine;
    }

    /// <summary>A függő kérések pillanatképe (UC-018) — a felület ebből tölti vissza a kártyák
    /// állapotát bot-váltás után.</summary>
    public IReadOnlyList<PermissionRequest> PendingPermissions
    {
        get
        {
            lock (_permGate)
            {
                return _pending.Values.ToList();
            }
        }
    }

    /// <summary>Válasz egy jóváhagyási kérésre. false, ha a kérés már nem él (időközben lejárt,
    /// megválaszolták, vagy a bot újraindult) — ez normális versenyhelyzet, nem hiba.</summary>
    public bool RespondToPermission(string requestId, PermissionDecision decision, string? denyMessage = null)
    {
        PermissionRequest? request;
        lock (_permGate)
        {
            if (!_pending.TryGetValue(requestId, out request) || request.Decision != PermissionDecision.Pending)
                return false;

            request.Decision = decision;
            _pending.Remove(requestId);
        }

        var allow = decision is PermissionDecision.Allowed or PermissionDecision.AllowedAlways;

        object inner;
        if (allow)
        {
            using var inputDoc = JsonDocument.Parse(request.InputJson);
            if (decision == PermissionDecision.AllowedAlways)
            {
                // Session hatókörű, ESZKÖZ-szintű szabály. Szándékosan nem a CLI saját
                // permission_suggestions javaslatát küldjük vissza: az localSettings célponttal
                // a lemezre írna, és csak a konkrét paraméterre (pl. egyetlen parancsra) adna
                // engedélyt — a felhasználó viszont az egész eszközt engedélyezte.
                inner = new
                {
                    behavior = "allow",
                    updatedInput = inputDoc.RootElement.Clone(),
                    updatedPermissions = new[]
                    {
                        new
                        {
                            type = "addRules",
                            rules = new[] { new { toolName = request.ToolName } },
                            behavior = "allow",
                            destination = "session",
                        },
                    },
                };
            }
            else
            {
                inner = new { behavior = "allow", updatedInput = inputDoc.RootElement.Clone() };
            }
        }
        else
        {
            inner = new
            {
                behavior = "deny",
                message = denyMessage ?? "A felhasználó elutasította az eszköz használatát.",
            };
        }

        SendControlResponse(requestId, inner);

        if (!allow)
            RecordTurnFailure(request, decision);

        RaiseLog(LogKind.Info, DescribeDecision(request, decision));
        PermissionResolved?.Invoke(request);
        return true;
    }

    private static string DescribeDecision(PermissionRequest request, PermissionDecision decision) => decision switch
    {
        PermissionDecision.Allowed => $"✅ Engedélyezve: {request.ToolName}",
        PermissionDecision.AllowedAlways => $"✅ Engedélyezve és felvéve az engedélyezett eszközök közé: {request.ToolName}",
        PermissionDecision.Denied => $"⛔ Elutasítva: {request.ToolName}",
        PermissionDecision.TimedOut => $"⏰ Nem érkezett válasz időben, automatikusan elutasítva: {request.ToolName}",
        _ => $"⚠ A jóváhagyási kérés érvénytelenné vált: {request.ToolName}",
    };

    /// <summary>Az elutasítás okát a kör végéig eltesszük, mert a claude.exe az elutasított
    /// tool-hívás után is `is_error: false`-szal zárja a kört — enélkül egy ütemezett feladat
    /// tévesen sikeresként könyvelődne el.</summary>
    private void RecordTurnFailure(PermissionRequest request, PermissionDecision decision)
    {
        if (request.OwningPromptUuid == null)
            return;

        var reason = decision == PermissionDecision.TimedOut
            ? $"A bot a(z) {request.ToolName} eszközhöz kért engedélyt, de nem érkezett válasz a határidőig — a kérés automatikusan elutasításra került."
            : $"A bot a(z) {request.ToolName} eszközhöz kért engedélyt, amit a felhasználó elutasított.";

        lock (_turnGate)
        {
            _turnFailureReason[request.OwningPromptUuid] = reason;
        }
    }

    /// <summary>Egyetlen söprő időzítő kezeli az összes lejáratot — kérésenkénti időzítő helyett,
    /// hogy ne maradjon felszabadítatlan erőforrás és ne legyen újrabelépési gond.</summary>
    private void EnsureExpiryTimer()
    {
        lock (_permGate)
        {
            _expiryTimer ??= new System.Threading.Timer(
                _ => ExpireOverdueRequests(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
        }
    }

    private void ExpireOverdueRequests()
    {
        List<PermissionRequest> overdue;
        lock (_permGate)
        {
            var now = DateTime.Now;
            overdue = _pending.Values.Where(r => r.ExpiresAt <= now).ToList();

            if (_pending.Count == 0)
            {
                _expiryTimer?.Dispose();
                _expiryTimer = null;
            }
        }

        foreach (var request in overdue)
        {
            RespondToPermission(
                request.RequestId,
                PermissionDecision.TimedOut,
                "A felhasználó nem válaszolt a jóváhagyási kérésre a megadott határidőn belül.");
        }
    }

    /// <summary>A folyamat leállásakor/újraindításakor minden függő kérés érvénytelen: a
    /// request_id csak az őt kiállító claude.exe példányon belül értelmes. Választ ilyenkor
    /// szándékosan NEM küldünk — nincs kinek.</summary>
    public void CancelAllPendingPermissions(string reason)
    {
        List<PermissionRequest> cancelled;
        lock (_permGate)
        {
            cancelled = _pending.Values.ToList();
            _pending.Clear();
            _expiryTimer?.Dispose();
            _expiryTimer = null;
        }

        foreach (var request in cancelled)
        {
            request.Decision = PermissionDecision.Cancelled;
            PermissionResolved?.Invoke(request);
        }

        if (cancelled.Count > 0)
            RaiseLog(LogKind.Info, $"⚠ {reason}");
    }

    /// <summary>Ha a folyamat a kör közben állt le, a `result` sor sosem érkezik meg — enélkül a
    /// feladat-ütemező nyilvántartásában a futás örökre "folyamatban" maradna, és az adott
    /// feladat minden további indítása kimaradna.</summary>
    private void AbandonActiveTurns(string reason)
    {
        List<string> abandoned;
        lock (_turnGate)
        {
            abandoned = _activeTurns.ToList();
            _activeTurns.Clear();
            _scheduledTurns.Clear();
            _turnFailureReason.Clear();
        }

        foreach (var uuid in abandoned)
            TurnCompleted?.Invoke(new TurnResult(uuid, IsError: true, reason));
    }

    private void SendControlResponse(string requestId, object inner)
    {
        var payload = new
        {
            type = "control_response",
            response = new { subtype = "success", request_id = requestId, response = inner },
        };

        WriteToProcess(JsonSerializer.Serialize(payload));
    }

    private void SendControlError(string requestId, string error)
    {
        var payload = new
        {
            type = "control_response",
            response = new { subtype = "error", request_id = requestId, error },
        };

        WriteToProcess(JsonSerializer.Serialize(payload));
    }

    /// <summary>Az EGYETLEN kimenő út a claude.exe felé — minden írás ezen megy át, hogy a
    /// párhuzamos szálak ne keverjék össze a sorokat (ld. <see cref="_stdinGate"/>).</summary>
    private bool WriteToProcess(string json)
    {
        lock (_stdinGate)
        {
            try
            {
                if (_process == null || _process.HasExited)
                    return false;

                LogDebug(">>", json);
                _process.StandardInput.WriteLine(json);
                return true;
            }
            catch (Exception ex)
            {
                RaiseLog(LogKind.Error, $"a claude.exe nem érhető el: {ex.Message}");
                return false;
            }
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

        // A ténylegesen elutasított tool-hívásokat csak ez a mező mutatja: a claude.exe
        // elutasítás után is `is_error: false`-szal zárja a kört.
        ReportPermissionDenials(root);

        string? failureReason;
        lock (_turnGate)
        {
            _activeTurns.Remove(uuid);
            _scheduledTurns.Remove(uuid);
            _turnFailureReason.Remove(uuid, out failureReason);
        }

        TurnCompleted?.Invoke(new TurnResult(uuid, isError, failureReason));
    }

    /// <summary>A `result` sor `permission_denials` tömbjét teszi láthatóvá a csevegésben. Ez
    /// kikapcsolt interaktív jóváhagyás mellett is fontos: enélkül a felhasználó számára néma
    /// marad, hogy a bot egy eszközhöz nem kapott engedélyt (BUG-004).</summary>
    private void ReportPermissionDenials(JsonElement root)
    {
        if (!root.TryGetProperty("permission_denials", out var denials) ||
            denials.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var denial in denials.EnumerateArray())
        {
            if (denial.ValueKind != JsonValueKind.Object)
                continue;

            var toolName = denial.TryGetProperty("tool_name", out var nameProp)
                ? nameProp.GetString() ?? "ismeretlen eszköz"
                : "ismeretlen eszköz";

            var detail = "";
            if (denial.TryGetProperty("tool_input", out var input) && input.ValueKind == JsonValueKind.Object)
                detail = SummarizeToolInput(input);

            var label = string.IsNullOrWhiteSpace(detail) ? toolName : $"{toolName}: {detail}";
            RaiseLog(LogKind.Info, $"🚫 Nem futott le engedély hiányában — {label}");
        }
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
        // Minden leállási út ide fut be (kézi Stop, törlés, összeomlás), ezért a függő kérések
        // és a nyitott körök lezárása itt a legmegbízhatóbb.
        CancelAllPendingPermissions("A bot leállt, a jóváhagyási kérés érvénytelenné vált.");
        AbandonActiveTurns("A bot folyamata leállt a kör közben.");

        SetStatus(BotStatus.Stopped);
        RaiseLog(LogKind.Info, "A claude.exe folyamat leállt.");
    }

    private void RaiseLog(LogKind kind, string text) => RaiseLog(new LogLine(kind, text));

    private void RaiseLog(LogLine line)
    {
        AccumulatedLog.Add(line);
        LogReceived?.Invoke(line);
    }

    // Minden nyers stream-json sor (ki- és bemenet is) egy fájlba kerül a bot workspace-ében —
    // ez teszi lehetővé, hogy diagnosztizálni lehessen, pontosan mit küld a claude.exe olyan
    // esetekben (pl. tool-engedélyezési kérés), amiket a UI még nem jelenít meg strukturáltan.
    private void LogDebug(string direction, string text)
    {
        // A naplóba több szálról írunk (a kimenetet olvasó szál és az írók), ezért zárolni kell:
        // enélkül a párhuzamos írások megosztási hibát dobnának, amit az alábbi catch elnyelne —
        // épp a hibakereséshez szükséges sorok vesznének el.
        lock (_logGate)
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
    }

    private void SetStatus(BotStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(status);
    }
}
