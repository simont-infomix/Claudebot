using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ClaudeBotApp;

public class WebViewBridge
{
    private readonly WebView2 _webView;
    private readonly BotSessionManager _manager;

    public WebViewBridge(WebView2 webView, BotSessionManager manager)
    {
        _webView = webView;
        _manager = manager;

        _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        _manager.BotListChanged += SendBotList;
        _manager.LogReceived += OnLogReceived;
        _manager.BotStatusChanged += OnBotStatusChanged;
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
            name = b.Name,
            status = StatusToString(b.Status),
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

    private static string KindToString(LogKind kind) => kind switch
    {
        LogKind.Error => "error",
        LogKind.Info => "info",
        LogKind.User => "user",
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
