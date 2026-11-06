using Microsoft.Web.WebView2.Core;

namespace ClaudeBotApp;

public partial class Form1 : Form
{
    private readonly string _botsRootDir = Path.Combine(AppContext.BaseDirectory, "Bots");
    private readonly string _webUiDir = Path.Combine(AppContext.BaseDirectory, "webui");
    private BotSessionManager? _manager;
    private WebViewBridge? _bridge;
    private BotTaskScheduler? _scheduler;
    private ChannelMcpServer? _channelServer;
    private BotMessageBus? _messageBus;

    /// <summary>A felhasználó a tálcaikon "Bezárás" menüpontjával tényleges kilépést kért — az
    /// ablak X gombja ettől megkülönböztetendő, mert az csak a tálcára rejt (ADR-0003).</summary>
    private bool _exitRequested;

    /// <summary>A mentetlen beállításokra vonatkozó kérdésre a felhasználó igennel válaszolt.</summary>
    private bool _unsavedChangesConfirmed;

    /// <summary>A tálcaikon két változata (UC-017): az alap ikon, és egy jobb felső sarokban
    /// jelölőpontos változat, ami akkor jelenik meg, ha legalább egy botnak van olvasatlan
    /// üzenete. Az <see cref="ApplyAppIcon"/> tölti be, az <see cref="UpdateTrayNotificationState"/>
    /// vált közöttük.</summary>
    private Icon? _trayIconNormal;
    private Icon? _trayIconNotify;

    /// <summary>Második, a NotifyIcon-tól FÜGGETLEN jelzési csatorna (UC-017): a taskbar-gomb
    /// overlay-jelvénye, ugyanaz a mechanizmus, mint amit pl. a Teams használ. Azért kell a
    /// NotifyIcon-badge MELLÉ, nem helyette, mert a Windows az új tálcaikonokat alapértelmezetten
    /// a rejtett ("^") ikonok közé teszi, ahol a jelölő változása könnyen észrevétlen marad —
    /// a taskbar-gomb viszont (amíg az ablak nincs a tálcára rejtve) mindig látható.</summary>
    private readonly TaskbarBadge _taskbarBadge = new();
    private Icon? _taskbarOverlayIcon;

    public Form1()
    {
        InitializeComponent();
        ApplyAppIcon();

#if DEBUG
        // Debug buildben nincs tálcára rejtés (ld. Form1_FormClosing) — a tálcaikon
        // beépülése csak megzavarná a fejlesztői tesztelést (pl. több párhuzamosan futó
        // példány esetén melyik a Debug, melyik a telepített Production).
        trayIcon.Visible = false;
#endif
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
        _trayIconNormal = new Icon(Icon, SystemInformation.SmallIconSize);
        _trayIconNotify = BuildNotificationIcon(_trayIconNormal);
        trayIcon.Icon = _trayIconNormal;
        _taskbarOverlayIcon = BuildOverlayDotIcon();
    }

    /// <summary>A megszokott "figyelj ide" jelentésű piros (ld. ui-design-guideline — Danger/
    /// Hiba szín). Ugyanaz a szín, mint a hiba-állapot pöttyéé — ott a pozíció (jobb alsó, nincs
    /// glow) különbözteti meg az olvasatlan-jelölőtől (jobb felső, glow-val).</summary>
    private static readonly Color NotificationColor = Color.FromArgb(255, 83, 112);

    /// <summary>A tálcaikon jobb felső sarkába rajzol egy jelölőpontot (UC-017). A bot-státusz
    /// pöttye (ld. ui-design-guideline) a jobb ALSÓ sarkot foglalja el, ezért ez nem ütközik vele.
    /// </summary>
    private static Icon BuildNotificationIcon(Icon baseIcon)
    {
        using var bitmap = baseIcon.ToBitmap();
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;

        var size = bitmap.Width;
        var dotDiameter = Math.Max(5, (int)(size * 0.42));
        var dotRect = new Rectangle(size - dotDiameter, 0, dotDiameter, dotDiameter);

        // Vékony sötét keret a jelölőpont körül, hogy világos tálca-témán is kontrasztos maradjon
        // — ugyanaz a minta, mint a bot-státusz pöttyé (border: var(--bg-base)).
        using (var borderBrush = new SolidBrush(Color.FromArgb(8, 12, 20)))
            graphics.FillEllipse(borderBrush, Rectangle.Inflate(dotRect, 1, 1));

        using (var dotBrush = new SolidBrush(NotificationColor))
            graphics.FillEllipse(dotBrush, dotRect);

        // Az Icon.FromHandle által visszaadott objektum nem birtokolja a GDI-handle-t (azt
        // DestroyIcon-nal kellene felszabadítani) — ez a folyamat teljes élettartamára szóló,
        // egyszeri (nem ismétlődő) handle, amit az OS a kilépéskor úgyis felszabadít.
        return Icon.FromHandle(bitmap.GetHicon());
    }

    /// <summary>A taskbar-gomb overlay-jelvénye (UC-017, ld. TaskbarBadge) — ÖNÁLLÓ, átlátszó
    /// hátterű pötty-ikon, nem a robot-ikonra rakott kompozit. A Windows maga komponálja rá a
    /// tálca-gomb sarkára, ezért itt nem kell (és nem is szabad) a teljes robotikont átrajzolni.
    /// </summary>
    private static Icon BuildOverlayDotIcon()
    {
        const int size = 16;
        using var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);

        var outerRect = new Rectangle(1, 1, size - 2, size - 2);
        using (var borderBrush = new SolidBrush(Color.FromArgb(8, 12, 20)))
            graphics.FillEllipse(borderBrush, outerRect);

        var innerRect = Rectangle.Inflate(outerRect, -1, -1);
        using (var dotBrush = new SolidBrush(NotificationColor))
            graphics.FillEllipse(dotBrush, innerRect);

        return Icon.FromHandle(bitmap.GetHicon());
    }

    /// <summary>Legalább egy botnak van-e olvasatlan üzenete (UC-017) — ez dönti el, melyik
    /// tálcaikon-változat és tooltip-szöveg látszik. A WebViewBridge.UnreadStateChanged a
    /// bot-folyamat kimenetét olvasó háttérszálon is kiváltódhat, ezért a trayIcon (UI-elem)
    /// módosítása előtt a UI-szálra kell marshalolni.</summary>
    private void UpdateTrayNotificationState()
    {
        if (InvokeRequired)
        {
            BeginInvoke(UpdateTrayNotificationState);
            return;
        }

        var hasUnread = _manager?.Bots.Any(b => b.HasUnreadMessage) ?? false;
        trayIcon.Icon = hasUnread ? _trayIconNotify : _trayIconNormal;
        trayIcon.Text = hasUnread ? "ClaudeBot — olvasatlan üzenet" : "ClaudeBot";

        _taskbarBadge.SetOverlay(
            Handle,
            hasUnread ? _taskbarOverlayIcon : null,
            hasUnread ? "Olvasatlan üzenet" : "");
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

        // A sorrend kötött (ADR-0005): a csatorna-szervernek a botok indítása (LoadExisting) előtt
        // kell élnie, mert a claude.exe a végpont címét csak induláskor kapja meg. A busz viszont
        // csak a menedzser után jöhet létre — ezért kerül bele a szerverbe utólag, az Attach-csal.
        _channelServer = new ChannelMcpServer();
        await _channelServer.StartAsync();

        _manager = new BotSessionManager(_botsRootDir, _channelServer.BaseUrl);
        _messageBus = new BotMessageBus(_manager);
        _channelServer.Attach(_manager, _messageBus);

        _scheduler = new BotTaskScheduler(_manager);
        _bridge = new WebViewBridge(webView, _manager, _scheduler);
        _bridge.ExitConfirmResponse += OnExitConfirmResponse;
        _bridge.UnreadStateChanged += UpdateTrayNotificationState;
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
        _bridge?.SetWindowVisible(false);
    }

    /// <summary>Egy második indítás jelzésére hozzuk elő az ablakot (ADR-0003): a felhasználó
    /// azért indította el újra az alkalmazást, mert nem látta, hogy már fut — a tálcára rejtett
    /// ablak előhozása pontosan az, amit várt. Az üzenet a rendszer minden legfelső szintű
    /// ablakának megy, ezért a 0 (sikertelen regisztráció) esetet külön ki kell zárni, különben
    /// minden ismeretlen üzenetre reagálnánk.</summary>
    protected override void WndProc(ref Message m)
    {
        if (SingleInstance.ShowWindowMessage != 0 && m.Msg == SingleInstance.ShowWindowMessage)
        {
            RestoreFromTray();
            return;
        }

        base.WndProc(ref m);
    }

    private void RestoreFromTray()
    {
        Show();

        if (WindowState == FormWindowState.Minimized)
            WindowState = FormWindowState.Normal;

        Activate();
        SingleInstance.BringToFront(Handle);
        _bridge?.SetWindowVisible(true);

        // A taskbar-gomb az ablak elrejtésekor eltűnik, visszaállításkor újra létrejön — az
        // overlay-jelvényt ezért újra alkalmazni kell rá, a korábbi állapot nem öröklődik át.
        UpdateTrayNotificationState();
    }

    private void Form1_FormClosing(object sender, FormClosingEventArgs e)
    {
        // Rendszerszintű leállítást soha nem fogunk el — ezeket blokkolni helytelen lenne.
        var systemInitiated = e.CloseReason
            is CloseReason.WindowsShutDown
            or CloseReason.TaskManagerClosing
            or CloseReason.ApplicationExitCall;

#if DEBUG
        // Debug buildben a tálcaikon ki van kapcsolva (ld. Form1 konstruktor) — tálcára
        // rejtés helyett az X gomb is teljes kilépést jelent, nehogy fejlesztés közben
        // láthatatlanul fusson tovább egy példány.
        _exitRequested = true;
#endif

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
        _channelServer?.Stop();
        trayIcon.Visible = false;
    }
}
