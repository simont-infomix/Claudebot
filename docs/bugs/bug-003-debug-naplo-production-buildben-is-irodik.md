---
id: bug-003
title: "BUG-003 — A claudebot-stream.log Production buildben is íródik"
type: bug
version: 0.1.0
created: 2026-10-29
updated: 2026-10-29
references:
  - uc-007
---

## Összefoglalás

A `claudebot-stream.log` (UC-007 — nyers stream-json kommunikáció naplója, minden bot
mappájában) feltétel nélkül, **minden build-konfigurációban** íródik — Release/Production
buildben is, nem csak Debug alatt. A felhasználói elvárás szerint ennek kizárólag Debug
build esetén kellene történnie; Production alatt a bot mappájába íródó, folyamatosan
növekvő, nyers kommunikációs napló nem kívánt (lemezhasználat, és a nyers tartalom
— pl. prompt-szövegek — szükségtelen perzisztálása éles használat közben).

## Reprodukálás

1. Készíts Release/Production buildet (`dotnet build -c Release`).
2. Indítsd el, küldj egy üzenetet bármelyik botnak.
3. **Eredmény:** a bot mappájában (`Bots/<bot-név>/claudebot-stream.log`) megjelenik/bővül
   a nyers kommunikációs napló, ugyanúgy, mint Debug buildben.

## Valószínű kiváltó ok

`ClaudeBotApp/BotSession.cs` — `LogDebug(string direction, string text)`:

```csharp
private void LogDebug(string direction, string text)
{
    try
    {
        var line = $"[{DateTime.Now:HH:mm:ss.fff}] {direction} {text}{Environment.NewLine}";
        File.AppendAllText(Path.Combine(FolderPath, DebugLogFileName), line);
    }
    catch { ... }
}
```

A hívásai (`SendPrompt`, `OnOutputDataReceived`, `OnErrorDataReceived`) nincsenek sem
`#if DEBUG` preprocesszor-direktívával, sem futásidejű konfigurációs kapcsolóval
védve — a metódus build-konfigurációtól függetlenül mindig lefut.

## Javaslat

A `LogDebug` törzsét `#if DEBUG` blokkba kell tenni (vagy a hívásokat egy
`Debugger`/konfigurációs kapcsolóval védeni), hogy Release buildben ne írjon fájlt.
Mivel UC-007 jelenleg nem tesz különbséget build-konfiguráció szerint, a javítással
egy időben a use case-t is pontosítani kell (pl. explicit "csak Debug buildben
elérhető" megkötéssel a 2.1 Precondition vagy 2.2 Exclusions szekcióban).
