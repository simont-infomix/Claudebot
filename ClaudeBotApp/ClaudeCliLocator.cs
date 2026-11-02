namespace ClaudeBotApp;

/// <summary>
/// A Claude Code parancssori eszköz (`claude.exe`) megkeresése, egyszer, az alkalmazás indulásakor.
///
/// Korábban a <see cref="BotSession"/> puszta fájlnévvel ("claude.exe") indította a folyamatot, és
/// a megtalálást a Windows `CreateProcess` keresési sorrendjére bízta. Ez a fejlesztői gépen
/// működik, egy másik gépen viszont botonkénti, néma hibává esik szét: a felhasználó annyit lát,
/// hogy egyik bot sem indul el. Ezért a feloldás ide került — egy helyre, indulás előtt.
/// </summary>
public static class ClaudeCliLocator
{
    /// <summary>Egyedi helyre telepített CLI esetén ezzel adható meg a teljes útvonal (vagy a
    /// mappája). A felderítés ezt nézi meg először, és a hibaüzenet is erre irányítja a
    /// felhasználót — enélkül egy nem szokványos telepítés zsákutca lenne.</summary>
    public const string EnvironmentVariableName = "CLAUDEBOT_CLI_PATH";

    private const string ExecutableName = "claude.exe";

    /// <summary>Az npm-es (`npm i -g @anthropic-ai/claude-code`) telepítés nem `.exe`-t, hanem egy
    /// batch-indítót tesz a PATH-ra. Azt a <see cref="BotSession"/> nem tudja használni
    /// (`UseShellExecute = false` mellett a CreateProcess nem futtat batch fájlt), de ha ez az
    /// egyetlen telepítés a gépen, a hibaüzenetben meg kell nevezni — különben a felhasználó
    /// jogosan hiszi, hogy a Claude Code "fent van".</summary>
    private const string NpmShimName = "claude.cmd";

    /// <summary>A feloldott, teljes útvonal. Amíg a <see cref="TryLocate"/> le nem futott
    /// sikeresen, a korábbi viselkedést őrzi (puszta fájlnév, a rendszer keresési sorrendjével).</summary>
    public static string ExecutablePath { get; private set; } = ExecutableName;

    /// <summary>
    /// Megkeresi a CLI-t. Siker esetén beállítja az <see cref="ExecutablePath"/>-ot és true-t ad.
    /// Hiba esetén a <paramref name="errorMessage"/> a felhasználónak megjeleníthető, cselekvésre
    /// bíró szöveg: hol kerestünk, mit találtunk helyette, és mit tegyen.
    /// </summary>
    public static bool TryLocate(out string errorMessage)
    {
        var searched = new List<string>();

        // 1. Explicit beállítás (ha van, az dönt — ld. lent), 2. PATH, 3. a natív telepítő
        // alapértelmezett helye.

        var configured = Environment.GetEnvironmentVariable(EnvironmentVariableName);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            var trimmed = configured.Trim().Trim('"');

            // Mappát is elfogadunk: könnyű elvéteni, és a hiba némán zsákutcába vinne.
            var candidate = Directory.Exists(trimmed) ? Path.Combine(trimmed, ExecutableName) : trimmed;

            if (File.Exists(candidate))
            {
                ExecutablePath = Path.GetFullPath(candidate);
                errorMessage = "";
                return true;
            }

            // Szándékosan NEM esünk vissza a további helyekre: ha valaki explicit megadta, hol
            // van a CLI, akkor egy elgépelt útvonalra hibát kell kapnia. A néma visszaesés azt
            // jelentené, hogy egy másik (esetleg régi) telepítés fut, és ezt semmi nem mutatja.
            errorMessage =
                $"A {EnvironmentVariableName} környezeti változó meg van adva, de nem mutat létező " +
                $"claude.exe fájlra:{Environment.NewLine}{Environment.NewLine}   {trimmed}" +
                $"{Environment.NewLine}{Environment.NewLine}Javítsd ki a változót (a claude.exe teljes " +
                "útvonalára vagy a mappájára), vagy töröld, ha a Claude Code a szokásos helyen van " +
                "telepítve — utóbbi esetben az alkalmazás magától megtalálja.";
            return false;
        }

        foreach (var dir in PathDirectories())
        {
            var candidate = Combine(dir, ExecutableName);
            if (candidate != null && File.Exists(candidate))
            {
                ExecutablePath = Path.GetFullPath(candidate);
                errorMessage = "";
                return true;
            }
        }

        searched.Add("a PATH környezeti változó könyvtárai");

        // A natív telepítő alapértelmezett helye. Akkor is megnézzük, ha nincs a PATH-on: friss
        // telepítés után a már futó munkamenetek (és az autostartból induló app) még a régi
        // PATH-ot öröklik.
        var defaultInstall = Combine(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin"),
            ExecutableName);

        if (defaultInstall != null && File.Exists(defaultInstall))
        {
            ExecutablePath = defaultInstall;
            errorMessage = "";
            return true;
        }

        if (defaultInstall != null)
            searched.Add(defaultInstall);

        errorMessage = BuildErrorMessage(searched);
        return false;
    }

    private static string BuildErrorMessage(IReadOnlyList<string> searched)
    {
        var lines = new List<string>
        {
            "A Claude Code parancssori eszköz (claude.exe) nem található ezen a gépen.",
            "",
            "A ClaudeBot minden botja egy-egy claude.exe folyamat, enélkül nincs mit elindítani.",
            "",
            "Keresett helyek:",
        };

        lines.AddRange(searched.Select(s => "   • " + s));

        var npmShim = FindNpmShim();
        if (npmShim != null)
        {
            lines.Add("");
            lines.Add($"Találtunk egy npm-es telepítést ({npmShim}), de a ClaudeBot a natív " +
                      "claude.exe-t igényli — a batch-indítót nem tudja közvetlenül futtatni.");
        }

        lines.Add("");
        lines.Add("Megoldás: telepítsd a Claude Code-ot a natív telepítővel, vagy — ha egyedi helyre " +
                  $"telepítetted — állítsd be a {EnvironmentVariableName} környezeti változót a " +
                  "claude.exe teljes útvonalára, és indítsd újra az alkalmazást.");

        return string.Join(Environment.NewLine, lines);
    }

    private static string? FindNpmShim()
    {
        foreach (var dir in PathDirectories())
        {
            var candidate = Combine(dir, NpmShimName);
            if (candidate != null && File.Exists(candidate))
                return candidate;
        }

        var npmDir = Combine(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm"),
            NpmShimName);

        return npmDir != null && File.Exists(npmDir) ? npmDir : null;
    }

    private static IEnumerable<string> PathDirectories() =>
        (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(d => d.Trim('"'))
            .Where(d => d.Length > 0);

    /// <summary>A PATH tartalmazhat szemetet (érvénytelen karaktereket, elgépelt bejegyzéseket) —
    /// egy ilyen elem miatt nem állhat meg a felderítés.</summary>
    private static string? Combine(string directory, string fileName)
    {
        try
        {
            return Path.Combine(directory, fileName);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
