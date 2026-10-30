---
id: bug-005
title: "BUG-005 — Tálcára rejtett állapotban újraindítva az app párhuzamos második példány indul"
type: bug
version: 0.1.0
created: 2026-10-30
updated: 2026-10-30
references:
  - decision-03
---

## Összefoglalás

A ClaudeBotApp nem ellenőrzi induláskor, hogy fut-e már egy másik példánya. Ha az
alkalmazás a tálcára van rejtve (ADR-0003: az X gomb tálcára rejt, nem lép ki), és a
felhasználó — nem észlelve, hogy a program már fut — újra elindítja az exe-t (pl. egy
parancsikonról vagy a Start menüből), egy **teljesen önálló, második folyamat** indul el
a már futó mellett. A két példány egymástól függetlenül tölti be ugyanazokat a bot
mappákat (`Bots/<bot-név>/`), és mindegyik saját `claude.exe` (és az azok alól induló
MCP-szerver) gyermekfolyamatokat indít minden botnak — a sub-process-ek száma így
botonként megduplázódik (vagy minden egyes véletlen újraindítással tovább nő).

## Megfigyelt/várható hatás

- Két (vagy több) `ClaudeBotApp.exe` fut egyszerre, mindkettő ugyanazt a `Bots/` mappát
  kezeli.
- Mindkét példány önállóan indítja el a ütemezett feladatok motorját (`BotTaskScheduler`)
  is — egy ütemezett feladat emiatt **duplán is lefuthat**, mert mindkét példány saját,
  egymástól független `ComputeNextRun`/polling ciklust futtat ugyanarra a feladat-
  definícióra.
- Mindkét példány saját tálcaikont (NotifyIcon) próbál regisztrálni, és mindkettő
  figyeli/írja ugyanazokat a bot-mappa fájljait (pl. `.bot-meta.json`,
  `claudebot-stream.log`) — egyidejű fájlírás esetén adatvesztés/korrupció kockázata áll
  fenn.
- A felhasználó számára ez nem nyilvánvaló: nincs semmilyen jelzés ("már fut egy
  példány"), az új indítás látszólag simán lefut, miközben a régi, tálcára rejtett
  példány is tovább működik a háttérben.

## Reprodukálás

1. Indítsd el a Release buildet, zárd be az ablakot X gombbal (tálcára rejt, ADR-0003).
2. Indítsd el újra ugyanazt az exe-t (pl. dupla kattintással).
3. **Eredmény:** egy második `ClaudeBotApp.exe` folyamat és egy második ablak jelenik
   meg, miközben az első, tálcára rejtett példány is tovább fut a Feladatkezelőben
   ellenőrizhetően (`tasklist` két `ClaudeBotApp.exe` sort mutat) — mindegyik alatt
   duplikált `claude.exe`/MCP-szerver gyermekfolyamatokkal.

## Valószínű kiváltó ok

`ClaudeBotApp/Program.cs` — a `Main()` belépési pont feltétel nélkül létrehoz egy új
`Form1` példányt és elindítja az `Application.Run`-t:

```csharp
[STAThread]
static void Main()
{
    ApplicationConfiguration.Initialize();
    Application.Run(new Form1());
}
```

Nincs egyetlen-példány (single-instance) védelem — sem egy névvel ellátott
`System.Threading.Mutex`, sem más mechanizmus (pl. named pipe/esemény), ami induláskor
észlelné egy már futó példány jelenlétét, és ami helyette azt a meglévő (esetleg tálcára
rejtett) ablakot hozná előtérbe ahelyett, hogy egy újat indítana.

## Javaslat

- `Program.Main()`-ben egy rendszerszintű, névvel ellátott `Mutex`-szal (pl.
  `Global\ClaudeBotApp-SingleInstance`) ellenőrizni, hogy fut-e már egy példány.
- Ha igen: **ne** induljon el egy új `Form1`, hanem a már futó példány ablaka kerüljön
  előtérbe (a tálcáról is visszaállítva, ha épp oda volt rejtve) — ehhez egy egyszerű
  inter-process jelzés szükséges (pl. egy `WM_SHOWCLAUDEBOT` regisztrált üzenet
  `PostMessage`-dzsel az összes toplevel ablaknak, amit a már futó `Form1` elkap és a
  meglévő `RestoreFromTray()`-t hívja meg rá).
- A Mutex-et a folyamat teljes élettartama alatt életben kell tartani (nem csak az
  induláskori ellenőrzés pillanatában), és az app tényleges kilépésekor (ld.
  `Form1_FormClosing`, ADR-0003 kilépési ág) felszabadítani.
