using System.Runtime.InteropServices;

namespace ClaudeBotApp;

/// <summary>
/// A Windows taskbar-gombra rajzolt kis jelölőikon (overlay icon) — ugyanaz a natív mechanizmus,
/// amit pl. a Microsoft Teams is használ az olvasatlan-jelzéshez (UC-017). Ez a rejtett/overflow
/// tálcaikontól (ld. NotifyIcon, Form1.UpdateTrayNotificationState) FÜGGETLEN, második jelzési
/// csatorna: amíg az ablaknak van tálca-gombja (nincs a tálcára rejtve, ld. ADR-0003), ez az
/// overlay megbízhatóan látszik, nem rejtheti el a Windows automatikusan.
///
/// A <c>ITaskbarList3</c> Windows 7 óta nyilvánosan dokumentált COM-felülete — nem igényel
/// csomagolt (MSIX) alkalmazás-azonosítót, ellentétben a UWP Badge-notifikáció API-val, amit
/// csak csomagolt appok érhetnek el.
/// </summary>
public sealed class TaskbarBadge
{
    private readonly ITaskbarList3? _taskbarList;

    public TaskbarBadge()
    {
        try
        {
            _taskbarList = (ITaskbarList3)new TaskbarInstance();
            _taskbarList.HrInit();
        }
        catch
        {
            // A COM-objektum létrehozása Windows 7+ alatt elvileg sosem bukik el, de a jelölő
            // hiánya nem lehet végzetes az app működésére — inkább néma lemondás, mint crash.
            _taskbarList = null;
        }
    }

    /// <summary>Beállítja vagy törli (icon: null) a megadott ablak taskbar-gombjának
    /// jelölőikonját. Nincs hatása, amíg az ablaknak nincs taskbar-gombja (pl. a tálcára
    /// rejtve) — ilyenkor csak a NotifyIcon-alapú jelzés látszódhat.</summary>
    public void SetOverlay(IntPtr windowHandle, Icon? icon, string description)
    {
        try
        {
            _taskbarList?.SetOverlayIcon(windowHandle, icon?.Handle ?? IntPtr.Zero, description);
        }
        catch
        {
            // ld. fent
        }
    }

    [ComImport, Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
    private class TaskbarInstance
    {
    }

    /// <summary>
    /// Csak a <see cref="SetOverlayIcon"/>-ig van ténylegesen szükségünk, de a COM-interop a
    /// vtable-SORREND (nem a metódusnevek) alapján dolgozik — az előtte álló metódusokat ezért
    /// akkor is pontosan ebben a sorrendben kell deklarálni, ha sosem hívjuk őket. A nem
    /// használt paramétertípusokat (struct-ok, tömbök) szándékosan IntPtr-re egyszerűsítettük.
    /// </summary>
    [ComImport, Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // ITaskbarList
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);

        // ITaskbarList2
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);

        // ITaskbarList3
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
        void SetProgressState(IntPtr hwnd, int flags);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMdi);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMdi, uint reserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint buttonCount, IntPtr buttons);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint buttonCount, IntPtr buttons);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
        void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string tip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr clipRect);
    }
}
