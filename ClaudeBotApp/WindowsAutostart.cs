using Microsoft.Win32;

namespace ClaudeBotApp;

/// <summary>
/// Az alkalmazás bejelentkezéskori automatikus indításának kezelése (ADR-0003). A felhasználó a
/// tálcaikon menüjéből kapcsolhatja, de első indításkor egyszer magától bekapcsol — az ütemezett
/// feladatok ugyanis csak futó alkalmazás mellett indulnak el, így a bekapcsolt állapot a
/// biztonságos alapértelmezés.
/// </summary>
public static class WindowsAutostart
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "ClaudeBot";

    /// <summary>Saját kulcs annak jelölésére, hogy a kezdeti bekapcsolás már megtörtént. Enélkül
    /// nem lehetne megkülönböztetni a "még sosem volt beállítva" és a "a felhasználó szándékosan
    /// kikapcsolta" állapotot — és minden indításkor visszakapcsolnánk, amit kikapcsolt.</summary>
    private const string AppKeyPath = @"Software\ClaudeBot";
    private const string InitializedValueName = "AutostartInitialized";

    /// <summary>Be van-e jelenleg kapcsolva az automatikus indítás.</summary>
    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(RunValueName) != null;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Be- vagy kikapcsolja az automatikus indítást. A HKCU alatt dolgozik, ezért nem igényel
    /// rendszergazdai jogot. Visszaadja, hogy sikerült-e — a hívó így tud visszajelezni, ha a
    /// regisztrációs adatbázis írása nem ment.
    /// </summary>
    public static bool SetEnabled(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            if (key == null)
                return false;

            if (!enabled)
            {
                key.DeleteValue(RunValueName, throwOnMissingValue: false);
                return true;
            }

            var exePath = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exePath))
                return false;

            key.SetValue(RunValueName, $"\"{exePath}\"", RegistryValueKind.String);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Első indításkor egyszer bekapcsolja az automatikus indítást, és ezt meg is jegyzi. A
    /// későbbi indítások már nem nyúlnak hozzá, így a felhasználó kikapcsolása tartós marad.
    /// </summary>
    public static void EnsureInitialRegistration()
    {
        try
        {
            using var appKey = Registry.CurrentUser.CreateSubKey(AppKeyPath);
            if (appKey == null || appKey.GetValue(InitializedValueName) != null)
                return;

            SetEnabled(true);
            appKey.SetValue(InitializedValueName, 1, RegistryValueKind.DWord);
        }
        catch
        {
            // Az automatikus indítás beállítása soha nem akadályozhatja az app indulását.
        }
    }

    /// <summary>
    /// A bejegyzett útvonal az aktuális exe-re mutat-e. Amíg nincs telepítő, egy mappaáthelyezés
    /// után a régi útvonal érvénytelenné válna — ilyenkor csendben frissítjük.
    /// </summary>
    public static void RefreshPathIfEnabled()
    {
        try
        {
            if (!IsEnabled())
                return;

            var exePath = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exePath))
                return;

            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            var desired = $"\"{exePath}\"";

            if (key != null && key.GetValue(RunValueName) as string != desired)
                key.SetValue(RunValueName, desired, RegistryValueKind.String);
        }
        catch
        {
            // ld. fent
        }
    }
}
