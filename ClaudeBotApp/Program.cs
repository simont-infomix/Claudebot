namespace ClaudeBotApp;

static class Program
{
    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        // Buildváltozatonként egyetlen példány (ADR-0003). Ez az első dolgunk: ha már fut egy
        // példány, csak előhozzuk az ablakát, és minden további indulási lépés értelmetlen.
        // A mutexet a Main teljes futása alatt életben kell tartani — a `using` pontosan addig
        // tartja, ameddig az Application.Run tart.
        if (!SingleInstance.TryAcquire(out var instanceMutex))
        {
            SingleInstance.SignalExistingInstance();
            return;
        }

        using (instanceMutex)
        {
            Run();
        }
    }

    private static void Run()
    {
        // To customize application configuration such as set high DPI settings or default font,
        // see https://aka.ms/applicationconfiguration.
        ApplicationConfiguration.Initialize();

        // A claude.exe hiányát itt, egyetlen érthető hibaüzenettel kezeljük, és el sem indulunk:
        // enélkül az alkalmazás elindulna, de minden bot külön-külön, a saját csevegésébe írt
        // indítási hibával dőlne el — abból a felhasználó nem tudná kitalálni, mi a teendő.
        if (!ClaudeCliLocator.TryLocate(out var cliError))
        {
            MessageBox.Show(
                cliError,
                "ClaudeBot — hiányzó Claude Code telepítés",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        Application.Run(new Form1());
    }    
}