using Microsoft.Win32;

namespace ClaudeBotApp;

/// <summary>
/// Az alkalmazás bejelentkezéskori automatikus indítása (ADR-0002). Szándékosan nincs hozzá
/// kapcsoló a felületen: az ütemezett feladatok csak futó alkalmazás mellett indulnak el, ezért
/// az automatikus indulás működési előfeltétel, nem opció.
/// </summary>
public static class WindowsAutostart
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "ClaudeBot";

    /// <summary>
    /// Beírja (vagy frissíti) a bejelentkezéskori indítás bejegyzését az aktuális exe útvonalával.
    /// A HKCU alatt dolgozik, ezért nem igényel rendszergazdai jogot. Hibát nem dob: ha a
    /// regisztráció nem sikerül, az app ettől még használható marad.
    /// </summary>
    public static void Register()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exePath))
                return;

            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            if (key == null)
                return;

            // Csak akkor írunk, ha ténylegesen változott — így nem nyúlunk feleslegesen a
            // regisztrációs adatbázishoz minden indításkor.
            var desired = $"\"{exePath}\"";
            if (key.GetValue(ValueName) as string == desired)
                return;

            key.SetValue(ValueName, desired, RegistryValueKind.String);
        }
        catch
        {
            // Az automatikus indítás regisztrálása soha nem akadályozhatja az app indulását.
        }
    }
}
