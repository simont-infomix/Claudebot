using Microsoft.Web.WebView2.Core;

namespace ClaudeBotApp;

public partial class Form1 : Form
{
    private readonly string _botsRootDir = Path.Combine(AppContext.BaseDirectory, "Bots");
    private readonly string _webUiDir = Path.Combine(AppContext.BaseDirectory, "webui");
    private BotSessionManager? _manager;
    private WebViewBridge? _bridge;

    public Form1()
    {
        InitializeComponent();
    }

    private async void Form1_Load(object sender, EventArgs e)
    {
        await webView.EnsureCoreWebView2Async();

        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "claudebot.local", _webUiDir, CoreWebView2HostResourceAccessKind.Allow);

        _manager = new BotSessionManager(_botsRootDir);
        _bridge = new WebViewBridge(webView, _manager);
        _manager.LoadExisting();

        webView.CoreWebView2.Navigate("https://claudebot.local/index.html");
    }

    private void Form1_FormClosing(object sender, FormClosingEventArgs e)
    {
        _manager?.StopAll();
    }
}
