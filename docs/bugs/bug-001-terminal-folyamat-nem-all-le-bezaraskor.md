---
id: bug-001
title: "BUG-001 — A bot-terminál (cmd + claude + MCP-szerver) nem áll le az app bezárásakor"
type: bug
version: 0.1.0
created: 2026-10-22
updated: 2026-10-22
references:
  - uc-003
---

## Összefoglalás

Ha egy bot munkamenetéhez a felhasználó megnyit egy natív terminált (UC-003, "Bot
terminál-munkamenetének megnyitása"), majd ezután bezárja a ClaudeBotApp alkalmazást
(nem összeomlás, hanem normál bezárás), a terminálban elindult `cmd.exe` ablak és az
abból indult `claude` CLI, illetve annak gyermekfolyamatai (pl. az `@azure-devops/mcp`
MCP-szerver node.exe-je) **életben maradnak**. Ezek a folyamatok a bot mappáját
(`Bots/<bot-név>/`) használják munkakönyvtárként, ezért nyitott könyvtár-handle-t
tartanak rajta — emiatt a bot mappája (és minden szülőkönyvtára, egészen a
`ClaudeBotApp` gyökeréig) utólag nem törölhető/nevezhető át: "A következő elérési
úthoz való hozzáférés megtagadva" / "A folyamat nem éri el a fájlt, mert már másik
folyamat használja" hibával.

## Megfigyelt eset

- Bot neve: `Sanyi`
- Mappa: `ClaudeBotApp/bin/Debug/net10.0-windows/Bots/Sanyi/`
- Az app bezárása után életben maradt folyamatok:
  - `cmd.exe` — a terminál ablak maga (`/K claude` argumentummal indítva), munkakönyvtár = a bot mappája
  - `node.exe` (`npx -y @azure-devops/mcp ...`) — a `claude` CLI session MCP-szerverének launcher wrappere
  - `node.exe` (`@azure-devops/mcp/dist/index.js ...`) — maga az MCP-szerver
- A Restart Manager API semmilyen fájl-zárolást nem jelzett ezekre a fájlokra — a
  zárolás oka nem nyitott fájl-handle, hanem a folyamatok munkakönyvtára (CWD) volt a
  bot mappájában, ami kimutatáshoz a folyamat PEB-jének (`ProcessParameters.CurrentDirectory`)
  közvetlen kiolvasására volt szükség.

## Reprodukálás

1. Nyiss meg egy bot terminálját (UC-003).
2. A terminálban futtass egy olyan `claude` munkamenetet, ami MCP-szervert indít (pl.
   azure-devops MCP).
3. Zárd be a ClaudeBotApp alkalmazást normálisan (ne a terminált, csak a fő appot).
4. Próbáld meg törölni/átnevezni a bot mappáját, vagy a teljes `ClaudeBotApp` mappát.
5. **Eredmény:** hozzáférés megtagadva / fájl használatban — a terminál `cmd.exe`-je és
   a belőle indult folyamatok továbbra is futnak, munkakönyvtáruk a törölni kívánt
   mappában van.

## Valószínű kiváltó ok

`BotSessionManager.OpenTerminal(string name)` (`ClaudeBotApp/BotSessionManager.cs`)
`UseShellExecute = true` móddal, önálló (nem gyermekként kezelt) ablakként indítja a
`cmd.exe /K claude` folyamatot:

```csharp
var psi = new ProcessStartInfo
{
    FileName = "cmd.exe",
    Arguments = "/K claude",
    WorkingDirectory = bot.FolderPath,
    UseShellExecute = true,
};
Process.Start(psi);
```

Ezt a folyamatot (és a PID-jét) a `BotSessionManager` sehol nem tárolja el, így sem a
`StopAll()`, sem az alkalmazás bezárási eseménykezelője nem tud rá (és a
gyermekfolyamataira) hivatkozni és leállítani azt. A `claude` CLI saját maga is
elindíthat olyan gyermekfolyamatokat (pl. MCP-szervereket), amelyek az app bezárása
után árván maradnak.

## Javaslat

- `OpenTerminal` mentse el az induló `cmd.exe` process-objektumot (PID-jét) a
  `BotSession`-ben, hogy app-bezáráskor/bot-leállításkor explicit módon leállítható
  (és a teljes process-fája, nem csak maga a `cmd.exe`) legyen.
- A folyamatot érdemes egy Windows Job Objecthez rendelni
  (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), hogy a `cmd.exe`-ből induló összes
  gyermek- és unoka-folyamat (pl. `claude`, illette az általa indított MCP-szerverek)
  automatikusan megszűnjön, amint a Job (és vele az app) megszűnik — akkor is, ha a
  folyamatfa időközben újra-szülősödik (reparenting), mint ebben az esetben.
- `StopAll()` (alkalmazás bezárásakor) hívja meg ezt az új leállítási logikát is,
  nem csak a `BotSession.Stop()`-ot.
