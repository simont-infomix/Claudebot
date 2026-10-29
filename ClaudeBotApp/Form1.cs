using Microsoft.Web.WebView2.Core;

namespace ClaudeBotApp;

public partial class Form1 : Form
{
    private readonly string _botsRootDir = Path.Combine(AppContext.BaseDirectory, "Bots");
    private readonly string _webUiDir = Path.Combine(AppContext.BaseDirectory, "webui");
    private BotSessionManager? _manager;
    private WebViewBridge? _bridge;
    private BotTaskScheduler? _scheduler;
    private bool _forceClosing;

    public Form1()
    {
        InitializeComponent();
    }

    private async void Form1_Load(object sender, EventArgs e)
    {
        // Az ütemezett feladatok csak futó alkalmazás mellett indulnak el, ezért az automatikus
        // indulás működési előfeltétel — nincs hozzá kapcsoló (ADR-0002).
        WindowsAutostart.Register();

        // A tálcaikon az ablak ikonját örökli, hogy ne kelljen külön erőforrást karbantartani.
        trayIcon.Icon = Icon;

        await webView.EnsureCoreWebView2Async();

        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "claudebot.local", _webUiDir, CoreWebView2HostResourceAccessKind.Allow);

        _manager = new BotSessionManager(_botsRootDir);
        _scheduler = new BotTaskScheduler(_manager);
        _bridge = new WebViewBridge(webView, _manager, _scheduler);
        _bridge.ExitConfirmResponse += OnExitConfirmResponse;
        _manager.LoadExisting();
        _manager.InitializeTaskSchedules();
        _scheduler.Start();

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

    private void TrayExitItem_Click(object? sender, EventArgs e) => Close();

    /// <summary>Tálcaikonra dupla kattintás: előhozza az ablakot, ha a felhasználó elrejtette
    /// vagy háttérbe került.</summary>
    private void TrayIcon_DoubleClick(object? sender, EventArgs e)
    {
        if (WindowState == FormWindowState.Minimized)
            WindowState = FormWindowState.Normal;

        Show();
        Activate();
    }

    // TODO: az ablak bezárása ne állítsa le az alkalmazást, csak minimalizálja a tálcára — a
    // kilépés ilyenkor kizárólag a tálcaikon "Bezárás" menüpontjával történne. Szándékosan
    // nincs most megvalósítva: a fejlesztés alatti build-ciklust megnehezítené, mert a futó
    // példány zárolja az exe-t (ld. ADR-0002).
    private void Form1_FormClosing(object sender, FormClosingEventArgs e)
    {
        if (_forceClosing)
        {
            _scheduler?.Stop();
            _manager?.StopAll();
            return;
        }

        if (_bridge?.HasUnsavedSettings == true)
        {
            e.Cancel = true;
            _bridge.RequestExitConfirmation();
            return;
        }

        _scheduler?.Stop();
        _manager?.StopAll();
    }
}
