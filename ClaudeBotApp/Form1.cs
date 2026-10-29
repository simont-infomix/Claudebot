using Microsoft.Web.WebView2.Core;

namespace ClaudeBotApp;

public partial class Form1 : Form
{
    private readonly string _botsRootDir = Path.Combine(AppContext.BaseDirectory, "Bots");
    private readonly string _webUiDir = Path.Combine(AppContext.BaseDirectory, "webui");
    private BotSessionManager? _manager;
    private WebViewBridge? _bridge;
    private BotTaskScheduler? _scheduler;

    /// <summary>A felhasználó a tálcaikon "Bezárás" menüpontjával tényleges kilépést kért — az
    /// ablak X gombja ettől megkülönböztetendő, mert az csak a tálcára rejt (ADR-0003).</summary>
    private bool _exitRequested;

    /// <summary>A mentetlen beállításokra vonatkozó kérdésre a felhasználó igennel válaszolt.</summary>
    private bool _unsavedChangesConfirmed;

    public Form1()
    {
        InitializeComponent();
        ApplyAppIcon();
    }

    /// <summary>
    /// Az ablak fejlécének és a tálcaikonnak ugyanazt a beágyazott ikont adja, amit az exe is
    /// visel. A konstruktorban fut, hogy ne villanjon fel előtte az alapértelmezett ikon.
    /// A tálcaikon külön, a rendszer kisikon-méretére illesztett példányt kap, mert a
    /// többfelbontású ikonból ez adja a legélesebb eredményt az adott DPI mellett.
    /// </summary>
    private void ApplyAppIcon()
    {
        var assembly = typeof(Form1).Assembly;

        // Név szerint keressük, nem rögzített erőforrás-azonosítóval: a névteret/fájlnevet
        // érintő átnevezés így nem töri el némán az ikont.
        var resourceName = assembly
            .GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("NeonRobot.ico", StringComparison.OrdinalIgnoreCase));

        if (resourceName == null)
            return;

        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream == null)
            return;

        Icon = new Icon(stream);
        trayIcon.Icon = new Icon(Icon, SystemInformation.SmallIconSize);
    }

    private async void Form1_Load(object sender, EventArgs e)
    {
        // Első indításkor egyszer bekapcsoljuk az automatikus indítást (az ütemezett feladatok
        // csak futó app mellett futnak), de a felhasználó kikapcsolása tartós marad (ADR-0003).
        WindowsAutostart.EnsureInitialRegistration();
        WindowsAutostart.RefreshPathIfEnabled();

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

        _unsavedChangesConfirmed = true;
        Close();
    }

    /// <summary>Tényleges kilépés — csak innen és a Windows leállításakor léphet ki az app, az
    /// ablak X gombjából nem (ADR-0003).</summary>
    private void TrayExitItem_Click(object? sender, EventArgs e)
    {
        _exitRequested = true;
        Close();
    }

    private void TrayOpenItem_Click(object? sender, EventArgs e) => RestoreFromTray();

    private void TrayIcon_DoubleClick(object? sender, EventArgs e) => RestoreFromTray();

    /// <summary>A menü minden megnyitásakor a regisztrációs adatbázis tényleges állapotát
    /// tükrözzük, nem egy gyorsítótárazott értéket — így akkor is helyes, ha közben kívülről
    /// (pl. a Feladatkezelő indítópult-lapján) módosították.</summary>
    private void TrayMenu_Opening(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        trayAutostartItem.Checked = WindowsAutostart.IsEnabled();
    }

    private void TrayAutostartItem_Click(object? sender, EventArgs e)
    {
        var desired = !WindowsAutostart.IsEnabled();

        if (!WindowsAutostart.SetEnabled(desired))
        {
            MessageBox.Show(
                "Az automatikus indítás beállítása nem sikerült.",
                "ClaudeBot",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }

        trayAutostartItem.Checked = WindowsAutostart.IsEnabled();
    }

    private void HideToTray()
    {
        Hide();
    }

    private void RestoreFromTray()
    {
        Show();

        if (WindowState == FormWindowState.Minimized)
            WindowState = FormWindowState.Normal;

        Activate();
    }

    private void Form1_FormClosing(object sender, FormClosingEventArgs e)
    {
        // Rendszerszintű leállítást soha nem fogunk el — ezeket blokkolni helytelen lenne.
        var systemInitiated = e.CloseReason
            is CloseReason.WindowsShutDown
            or CloseReason.TaskManagerClosing
            or CloseReason.ApplicationExitCall;

        // Minden más bezárás (X gomb, Alt+F4, nyers WM_CLOSE) csak a tálcára rejt, nem lép ki —
        // így az ütemezett feladatok tovább futnak (ADR-0003). Kilépni a tálcaikon "Bezárás"
        // menüpontjával lehet. Szándékosan nem csak a CloseReason.UserClosing esetet kezeljük:
        // egy kívülről küldött WM_CLOSE-nál a CloseReason None marad, és az is rejtést érdemel.
        if (!_exitRequested && !systemInitiated)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }

        // Csak a felhasználó kezdeményezte kilépésnél kérdezünk rá a mentetlen beállításokra.
        // A Windows leállítását/kijelentkezést szándékosan nem blokkoljuk egy kérdéssel — ott
        // legfeljebb egy el nem mentett beállítás-piszkozat vész el.
        if (_exitRequested && !_unsavedChangesConfirmed && _bridge?.HasUnsavedSettings == true)
        {
            e.Cancel = true;
            RestoreFromTray();
            _bridge.RequestExitConfirmation();
            return;
        }

        _scheduler?.Stop();
        _manager?.StopAll();
        trayIcon.Visible = false;
    }
}
