using Microsoft.Web.WebView2.Core;

namespace ClaudeBotApp;

public partial class Form1 : Form
{
    private readonly string _botsRootDir = Path.Combine(AppContext.BaseDirectory, "Bots");
    private readonly string _webUiDir = Path.Combine(AppContext.BaseDirectory, "webui");
    private readonly string _botTemplateDir = Path.Combine(AppContext.BaseDirectory, "BotTemplate");
    private BotSessionManager? _manager;
    private WebViewBridge? _bridge;
    private bool _forceClosing;

    public Form1()
    {
        InitializeComponent();
    }

    private async void Form1_Load(object sender, EventArgs e)
    {
        await webView.EnsureCoreWebView2Async();

        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "claudebot.local", _webUiDir, CoreWebView2HostResourceAccessKind.Allow);

        _manager = new BotSessionManager(_botsRootDir, _botTemplateDir);
        _bridge = new WebViewBridge(webView, _manager);
        _bridge.ExitConfirmResponse += OnExitConfirmResponse;
        _manager.LoadExisting();

        webView.CoreWebView2.Navigate("https://claudebot.local/index.html");
    }

    // A döntést a React oldal saját (Aurora-stílusú) dialógusa hozza meg, nem egy natív
    // WinForms MessageBox — lásd Form1_FormClosing és WebViewBridge.RequestExitConfirmation.
    private void OnExitConfirmResponse(bool confirmed)
    {
        if (!confirmed)
            return;

        _forceClosing = true;
        Close();
    }

    private void Form1_FormClosing(object sender, FormClosingEventArgs e)
    {
        if (_forceClosing)
        {
            _manager?.StopAll();
            return;
        }

        if (_bridge?.HasUnsavedSettings == true)
        {
            e.Cancel = true;
            _bridge.RequestExitConfirmation();
            return;
        }

        _manager?.StopAll();
    }
}
