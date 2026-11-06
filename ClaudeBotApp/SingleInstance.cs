using System.Runtime.InteropServices;

namespace ClaudeBotApp;

/// <summary>
/// Gondoskodik arról, hogy buildváltozatonként legfeljebb egy példány fusson, és hogy a második
/// indítás a már futó példány ablakát hozza elő.
///
/// Azért kell, mert az ablak X gombja a tálcára rejt, nem lép ki (ADR-0003): a felhasználó nem
/// feltétlenül látja, hogy a program már fut, és újraindítva egy teljesen önálló második folyamat
/// keletkezne. A két példány ugyanazt a <c>Bots/</c> mappát kezelné, mindkettő saját
/// <c>claude.exe</c> gyermekfolyamatokat indítana, és mindkettő saját ütemezőt futtatna ugyanazokra
/// a feladat-definíciókra — vagyis a feladatok duplán futnának, a meta-fájlok pedig egyszerre két
/// írót kapnának.
///
/// A Debug és a Release build szándékosan KÜLÖN példánynak számít: külön mappából futnak, külön
/// <c>Bots/</c> mappával, és fejlesztés közben a telepített példány mellett kell tudni futtatni a
/// frissen fordítottat. Egy változatból viszont továbbra sem futhat kettő.
/// </summary>
internal static class SingleInstance
{
#if DEBUG
    private const string BuildVariant = "Debug";
#else
    private const string BuildVariant = "Release";
#endif

    /// <summary>`Local\` és nem `Global\`: a hatókör a Windows-munkamenet. Egy gépen több
    /// felhasználó párhuzamosan dolgozhat, és egyikük futó példánya ne akadályozza a másikét —
    /// ráadásul az előtérbe hozó üzenet sem jutna át a munkamenet határán.</summary>
    private const string MutexName = @"Local\ClaudeBotApp-SingleInstance-" + BuildVariant;

    /// <summary>Rendszerszinten egyedi ablak-üzenet: ezt küldi a második indítás a már futónak.
    /// A buildváltozat a névben van, különben egy Debug indítás a telepített példányt hozná elő.
    /// Hiba esetén 0 — ilyenkor a jelzés egyszerűen elmarad (a második példány akkor sem indul el).</summary>
    public static readonly uint ShowWindowMessage =
        RegisterWindowMessage("ClaudeBotApp.ShowWindow." + BuildVariant);

    private const uint HwndBroadcast = 0xFFFF;
    private const uint AsfwAny = unchecked((uint)-1);

    /// <summary>
    /// Megpróbálja megszerezni a buildváltozat egyetlen "futok" jelzését. A visszaadott mutexet a
    /// hívónak a folyamat teljes élettartama alatt életben kell tartania — a felszabadításával
    /// ugyanis azonnal indíthatóvá válna egy másik példány.
    /// </summary>
    public static bool TryAcquire(out Mutex? mutex)
    {
        try
        {
            mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
            if (createdNew)
                return true;

            mutex.Dispose();
            mutex = null;
            return false;
        }
        catch (Exception)
        {
            // Ha a mutex bármiért nem hozható létre (jogosultság, névütközés), inkább elindulunk:
            // a védelem hiánya kellemetlen, az indulás megtagadása viszont használhatatlanná tenné
            // az alkalmazást.
            mutex = null;
            return true;
        }
    }

    /// <summary>Kéri a már futó példányt, hogy hozza elő az ablakát. A broadcast minden legfelső
    /// szintű ablakot elér — a tálcára rejtettet is, mert az csak láthatatlan, nem szűnt meg.</summary>
    public static void SignalExistingInstance()
    {
        if (ShowWindowMessage == 0)
            return;

        // A Windows alapból nem engedi, hogy egy folyamat más folyamat ablakát előtérbe hozza. Ezt
        // az induló (és rögtön kilépő) példány engedi át: ő most még a felhasználó legutóbbi
        // interakciójának birtokosa, tehát neki van joga átadni.
        AllowSetForegroundWindow(AsfwAny);
        PostMessage((IntPtr)HwndBroadcast, ShowWindowMessage, IntPtr.Zero, IntPtr.Zero);
    }

    /// <summary>A már futó példány hívja, amikor megkapta a jelzést. Az <c>Activate()</c> önmagában
    /// nem mindig elég: ha a hívás pillanatában más alkalmazás az aktív, a Windows legfeljebb
    /// villogtatja a tálca-gombot.</summary>
    public static void BringToFront(IntPtr windowHandle) => SetForegroundWindow(windowHandle);

    // Szándékosan DllImport és nem a modernebb LibraryImport: utóbbi forráskódgenerátora
    // unsafe blokkokat hoz létre, amihez az egész projektre engedélyezni kellene az unsafe kódot
    // — aránytalan ár négy egyszerű user32-hívásért.
    [DllImport("user32.dll", EntryPoint = "RegisterWindowMessageW", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);

    [DllImport("user32.dll", EntryPoint = "PostMessageW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
}
