using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Linq;

namespace ClaudeBotApp;

public class WebViewBridge
{
    private readonly WebView2 _webView;
    private readonly BotSessionManager _manager;
    private readonly BotTaskScheduler _scheduler;

    /// <summary>A React oldal jelzi ezen keresztül, ha egy bot Settings lapján mentetlen
    /// módosítás van — a Form1_FormClosing ez alapján kérdez rá bezáráskor.</summary>
    public bool HasUnsavedSettings { get; private set; }

    /// <summary>A Form1_FormClosing a bezárás helyett ezt hívja, ha mentetlen módosítás van —
    /// a React oldal a saját (Aurora-stílusú) megerősítő dialógusát jeleníti meg a natív
    /// WinForms MessageBox helyett, majd a döntést itt jelzi vissza.</summary>
    public event Action<bool>? ExitConfirmResponse;

    public WebViewBridge(WebView2 webView, BotSessionManager manager, BotTaskScheduler scheduler)
    {
        _webView = webView;
        _manager = manager;
        _scheduler = scheduler;

        _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        _manager.BotListChanged += SendBotList;
        _manager.LogReceived += OnLogReceived;
        _manager.BotStatusChanged += OnBotStatusChanged;
    }

    public void RequestExitConfirmation()
    {
        PostEvent(new { type = "confirmExit" });
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeProp))
                return;

            switch (typeProp.GetString())
            {
                case "getBots":
                    SendBotList();
                    break;

                case "createBot":
                    if (root.TryGetProperty("name", out var nameProp))
                    {
                        var (success, error) = _manager.CreateBot(nameProp.GetString() ?? "");
                        if (!success)
                        {
                            PostEvent(new { type = "error", message = error });
                        }
                    }
                    break;

                case "selectBot":
                    if (root.TryGetProperty("botId", out var selectIdProp))
                    {
                        SendBotLog(selectIdProp.GetString() ?? "");
                    }
                    break;

                case "openTerminal":
                    if (root.TryGetProperty("botId", out var openIdProp))
                    {
                        try
                        {
                            _manager.OpenTerminal(openIdProp.GetString() ?? "");
                        }
                        catch (Exception ex)
                        {
                            PostEvent(new { type = "error", message = $"A terminál megnyitása sikertelen: {ex.Message}" });
                        }
                    }
                    break;

                case "openWorkspaceFolder":
                    if (root.TryGetProperty("botId", out var folderIdProp))
                    {
                        try
                        {
                            _manager.OpenWorkspaceFolder(folderIdProp.GetString() ?? "");
                        }
                        catch (Exception ex)
                        {
                            PostEvent(new { type = "error", message = $"A munka mappa megnyitása sikertelen: {ex.Message}" });
                        }
                    }
                    break;

                case "deleteBot":
                    if (root.TryGetProperty("botId", out var deleteIdProp))
                    {
                        var (deleted, deleteError) = _manager.DeleteBot(deleteIdProp.GetString() ?? "");
                        if (!deleted)
                        {
                            PostEvent(new { type = "error", message = deleteError });
                        }
                    }
                    break;

                case "restartBot":
                    if (root.TryGetProperty("botId", out var restartIdProp))
                    {
                        _manager.RestartBot(restartIdProp.GetString() ?? "");
                    }
                    break;

                case "saveSettings":
                    if (root.TryGetProperty("botId", out var settingsBotIdProp) &&
                        root.TryGetProperty("name", out var settingsNameProp) &&
                        root.TryGetProperty("allowedTools", out var settingsToolsProp) &&
                        settingsToolsProp.ValueKind == JsonValueKind.Array)
                    {
                        var tools = settingsToolsProp.EnumerateArray()
                            .Select(t => t.GetString() ?? "")
                            .ToList();
                        var model = root.TryGetProperty("model", out var modelProp) ? modelProp.GetString() : null;
                        var effort = root.TryGetProperty("effort", out var effortProp) ? effortProp.GetString() : null;
                        var permissionMode = root.TryGetProperty("permissionMode", out var permissionModeProp)
                            ? permissionModeProp.GetString() : null;

                        var scheduledTasks = new List<ScheduledTask>();
                        if (root.TryGetProperty("scheduledTasks", out var tasksProp) &&
                            tasksProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var taskEl in tasksProp.EnumerateArray())
                            {
                                scheduledTasks.Add(ParseScheduledTask(taskEl));
                            }
                        }

                        var botId = settingsBotIdProp.GetString() ?? "";
                        var (success, error, newId) = _manager.ApplySettings(
                            botId, settingsNameProp.GetString() ?? "", tools, model, effort, permissionMode, scheduledTasks);

                        if (!success)
                        {
                            PostEvent(new { type = "error", message = error });
                        }
                        else if (newId != null)
                        {
                            PostEvent(new { type = "botRenamed", oldId = botId, newId });
                        }
                    }
                    break;

                case "runTask":
                    if (root.TryGetProperty("botId", out var runBotIdProp) &&
                        root.TryGetProperty("taskId", out var runTaskIdProp))
                    {
                        var (started, runError) = _scheduler.RunNow(
                            runBotIdProp.GetString() ?? "", runTaskIdProp.GetString() ?? "");

                        if (!started)
                        {
                            PostEvent(new { type = "error", message = runError });
                        }
                    }
                    break;

                case "getBotDetails":
                    if (root.TryGetProperty("botId", out var detailsBotIdProp))
                    {
                        SendBotDetails(detailsBotIdProp.GetString() ?? "");
                    }
                    break;

                case "setSettingsDirty":
                    if (root.TryGetProperty("dirty", out var dirtyProp))
                    {
                        HasUnsavedSettings = dirtyProp.GetBoolean();
                    }
                    break;

                case "respondToExitConfirm":
                    if (root.TryGetProperty("confirmed", out var confirmedProp))
                    {
                        ExitConfirmResponse?.Invoke(confirmedProp.GetBoolean());
                    }
                    break;

                case "setBotAvatar":
                    if (root.TryGetProperty("botId", out var avatarBotIdProp) &&
                        root.TryGetProperty("contentType", out var avatarContentTypeProp) &&
                        root.TryGetProperty("dataBase64", out var avatarDataProp))
                    {
                        try
                        {
                            _manager.SetAvatar(
                                avatarBotIdProp.GetString() ?? "",
                                avatarContentTypeProp.GetString() ?? "image/png",
                                avatarDataProp.GetString() ?? "");
                        }
                        catch (Exception ex)
                        {
                            PostEvent(new { type = "error", message = $"A kép mentése sikertelen: {ex.Message}" });
                        }
                    }
                    break;

                case "sendPrompt":
                    if (root.TryGetProperty("botId", out var promptBotIdProp) &&
                        root.TryGetProperty("text", out var promptTextProp))
                    {
                        var botId = promptBotIdProp.GetString() ?? "";
                        var attachmentNames = new List<string>();

                        if (root.TryGetProperty("attachments", out var attachmentsProp) &&
                            attachmentsProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var attachment in attachmentsProp.EnumerateArray())
                            {
                                if (!attachment.TryGetProperty("name", out var attNameProp) ||
                                    !attachment.TryGetProperty("dataBase64", out var attDataProp))
                                    continue;

                                try
                                {
                                    var savedName = _manager.SaveAttachment(
                                        botId, attNameProp.GetString() ?? "", attDataProp.GetString() ?? "");
                                    if (savedName != null)
                                    {
                                        attachmentNames.Add(savedName);
                                    }
                                }
                                catch (Exception ex)
                                {
                                    PostEvent(new { type = "error", message = $"Csatolmány mentése sikertelen: {ex.Message}" });
                                }
                            }
                        }

                        _manager.SendPrompt(botId, promptTextProp.GetString() ?? "", attachmentNames);
                    }
                    break;
            }
        }
        catch (JsonException)
        {
            // érvénytelen üzenet a JS oldalról — figyelmen kívül hagyjuk
        }
    }

    private void SendBotList()
    {
        var bots = _manager.Bots.Select(b => new
        {
            id = b.Name,
            name = b.DisplayName,
            status = StatusToString(b.Status),
            avatarDataUrl = _manager.GetAvatarDataUrl(b.Name),
            allowedTools = b.AllowedTools,
            model = b.Model,
            effort = b.Effort,
            permissionMode = b.PermissionMode,
            scheduledTasks = b.ScheduledTasks.Select(ToTaskPayload),
        });

        PostEvent(new { type = "botList", bots });
    }

    private void SendBotLog(string botId)
    {
        var bot = _manager.FindBot(botId);
        if (bot == null)
            return;

        var lines = bot.AccumulatedLog.Select(l => new
        {
            kind = KindToString(l.Kind),
            text = l.Text,
        });

        PostEvent(new { type = "botLog", botId, lines });
    }

    private void SendBotDetails(string botId)
    {
        var (agentDefinition, skills, subAgents) = _manager.GetBotDetails(botId);
        PostEvent(new
        {
            type = "botDetails",
            botId,
            agentDefinition,
            skills = skills.Select(c => new { name = c.Name, description = c.Description }),
            subAgents = subAgents.Select(c => new { name = c.Name, description = c.Description }),
        });
    }

    private void OnLogReceived(BotSession bot, LogLine line)
    {
        PostEvent(new
        {
            type = "logAppended",
            botId = bot.Name,
            line = new { kind = KindToString(line.Kind), text = line.Text },
        });
    }

    private void OnBotStatusChanged(BotSession bot, BotStatus status)
    {
        PostEvent(new { type = "botStatusChanged", botId = bot.Name, status = StatusToString(status) });
    }

    private static string StatusToString(BotStatus status) => status switch
    {
        BotStatus.Running => "running",
        BotStatus.Error => "error",
        _ => "stopped",
    };

    /// <summary>A React oldalról érkező feladat-objektum beolvasása. Csak a DEFINÍCIÓS mezőket
    /// veszi át — a futásidejű mezőket (utolsó/következő futás) a scheduler tartja karban, és a
    /// mentés azokat azonosító alapján megőrzi (ld. ADR-0001).</summary>
    private static ScheduledTask ParseScheduledTask(JsonElement el)
    {
        var task = new ScheduledTask
        {
            Id = el.TryGetProperty("id", out var idProp) && idProp.GetString() is { Length: > 0 } id
                ? id
                : Guid.NewGuid().ToString("N"),
            Name = el.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? "" : "",
            Prompt = el.TryGetProperty("prompt", out var promptProp) ? promptProp.GetString() ?? "" : "",
            Enabled = !el.TryGetProperty("enabled", out var enabledProp) || enabledProp.GetBoolean(),
        };

        if (el.TryGetProperty("schedule", out var sched) && sched.ValueKind == JsonValueKind.Object)
        {
            task.Schedule = new TaskSchedule
            {
                Type = ScheduleTypeFromString(
                    sched.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null),
                IntervalMinutes = sched.TryGetProperty("intervalMinutes", out var imProp) &&
                                  imProp.ValueKind == JsonValueKind.Number
                    ? imProp.GetInt32()
                    : null,
                TimeOfDay = sched.TryGetProperty("timeOfDay", out var todProp) ? todProp.GetString() : null,
                DaysOfWeek = ReadIntList(sched, "daysOfWeek"),
                DaysOfMonth = ReadIntList(sched, "daysOfMonth"),
            };
        }

        return task;
    }

    private static List<int>? ReadIntList(JsonElement parent, string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var prop) || prop.ValueKind != JsonValueKind.Array)
            return null;

        return prop.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.Number)
            .Select(e => e.GetInt32())
            .ToList();
    }

    /// <summary>A feladat kimenő alakja a React oldal felé — az enumokat szövegesen adjuk át, a
    /// dátumokat ISO-8601-ben, mert a felület így várja őket.</summary>
    private static object ToTaskPayload(ScheduledTask t) => new
    {
        id = t.Id,
        name = t.Name,
        prompt = t.Prompt,
        enabled = t.Enabled,
        schedule = new
        {
            type = ScheduleTypeToString(t.Schedule.Type),
            intervalMinutes = t.Schedule.IntervalMinutes,
            timeOfDay = t.Schedule.TimeOfDay,
            daysOfWeek = t.Schedule.DaysOfWeek,
            daysOfMonth = t.Schedule.DaysOfMonth,
        },
        lastRun = t.LastRun == null
            ? null
            : new
            {
                at = t.LastRun.At.ToString("o"),
                outcome = OutcomeToString(t.LastRun.Outcome),
                error = t.LastRun.Error,
            },
        nextRunAt = t.NextRunAt?.ToString("o"),
    };

    private static string ScheduleTypeToString(TaskScheduleType type) => type switch
    {
        TaskScheduleType.Interval => "interval",
        TaskScheduleType.Monthly => "monthly",
        _ => "weekly",
    };

    private static TaskScheduleType ScheduleTypeFromString(string? value) => value switch
    {
        "interval" => TaskScheduleType.Interval,
        "monthly" => TaskScheduleType.Monthly,
        _ => TaskScheduleType.Weekly,
    };

    private static string OutcomeToString(TaskRunOutcome outcome) => outcome switch
    {
        TaskRunOutcome.Success => "success",
        TaskRunOutcome.Failed => "failed",
        _ => "skipped",
    };

    private static string KindToString(LogKind kind) => kind switch
    {
        LogKind.Error => "error",
        LogKind.Info => "info",
        LogKind.User => "user",
        LogKind.Thinking => "thinking",
        _ => "assistant",
    };

    private void PostEvent(object payload)
    {
        var json = JsonSerializer.Serialize(payload);

        if (_webView.InvokeRequired)
        {
            _webView.Invoke(new Action(() => PostEvent(json)));
            return;
        }

        PostEvent(json);
    }

    private void PostEvent(string json)
    {
        if (_webView.CoreWebView2 != null)
        {
            _webView.CoreWebView2.PostWebMessageAsJson(json);
        }
    }
}
