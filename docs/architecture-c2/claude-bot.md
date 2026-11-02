---
id: architecture-c2-claude-bot
title: Architektúra diagram — C2 (Container) – ClaudeBot
type: architecture-c2
version: 0.2.0
created: 2026-10-15
updated: 2026-11-02
references:
  - architecture-c1
  - decision-05
---

## Leírás

A ClaudeBot rendszeren belül négy container van: egy natív host alkalmazás (.NET WinForms), egy
abba ágyazott webes felhasználói felület (React, WebView2-n keresztül megjelenítve), egy helyi
fájlrendszer-alapú tároló botonként, és a ténylegesen futtatott AI-ügynöki folyamat (a `claude.exe`
CLI, headless módban). A natív host és a webes UI egy JavaScript-híd (bridge) üzeneteivel
kommunikál egymással; nincs külön szerver-container, a rendszer teljes egészében a felhasználó
gépén fut.

A bot-session-ök egymással is tudnak üzenni: a natív host egy közös üzenet-csatornát ajánl ki
feléjük (ADR-0005), amin egy bot feladatot delegálhat egy másiknak. Ez nem új container — a
csatorna a natív hoszton belül él, és a session-ök a már meglévő kapcsolatukon érik el.

## Diagram

```mermaid
C4Container
    title ClaudeBot — Container Diagram

    Person(user, "Felhasználó")
    System_Ext(anthropicApi, "Anthropic Claude API")
    System_Ext(m365, "Microsoft 365 (Outlook/Teams)")

    System_Boundary(claudeBot, "ClaudeBot") {
        Container(winformsHost, "WinForms Host", ".NET 10, C# WinForms", "WebView2-t hosztol, felügyeli a bot-session-ök életciklusát, és (tervezetten) időzített feladatokat indít")
        Container(reactUi, "React UI", "React, Microsoft.Web.WebView2", "Bot-választó sáv, élő log-nézet; JS bridge-en keresztül vezérli a hostot")
        ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer", "Botonként egy almappa: a claude.exe munkakönyvtára, benne a skill-ek/agent-configok")
        Container(claudeSession, "Claude Code CLI session", "Anthropic claude.exe, headless (stream-json)", "Botonként egy önálló, hosszú életű subprocess, ami az AI-ügynöki logikát futtatja")
    }

    Rel(user, reactUi, "Használja")
    Rel(reactUi, winformsHost, "JS bridge: postMessage (pl. új bot létrehozása, terminál nyitása)")
    Rel(winformsHost, reactUi, "JS bridge: PostWebMessageAsJson (bot-lista, élő log-események)")
    Rel(winformsHost, claudeSession, "Indítja/felügyeli; stdin JSON-sorok (prompt), időzített küldés, bot-bot üzenetek kézbesítése")
    Rel(claudeSession, winformsHost, "stdout JSON-sorok (assistant válasz); MCP tool-hívások a bot-csatornához (ADR-0005)")
    Rel(winformsHost, botWorkspace, "Mappa létrehozása új bot felvételekor")
    Rel(claudeSession, botWorkspace, "Munkakönyvtár: skill-ek/agent-configok olvasása, fájlműveletek")
    Rel(claudeSession, anthropicApi, "API-hívások")
    Rel(claudeSession, m365, "Levelek/üzenetek lekérdezése (tervezett, MCP-n keresztül)")
```

## Elemek

| Elem | Típus | Technológia | Leírás |
|---|---|---|---|
| WinForms Host | Container | .NET 10, C# WinForms | A natív alkalmazás-keret: egyetlen folyamat, ami a WebView2-t hosztolja, a bot-session-öket (subprocess-eket) indítja/leállítja, és a jövőben az időzített feladat-ütemezésért felel. |
| React UI | Container | React, Microsoft.Web.WebView2 | A teljes vizuális felület a WinForms Host-ba ágyazott WebView2 control-ban: bot-avatarok, élő log-nézet, (később) beállítások. |
| Bot workspace | Container (adattár) | Helyi fájlrendszer | Botonként egy almappa a program könyvtárán belül; ez a `claude.exe` munkakönyvtára, és ide kerülnek a skill-ek/agent-configok. |
| Claude Code CLI session | Container | Anthropic `claude.exe` (headless, `stream-json`) | Botonként egy önálló, hosszú életű subprocess; a tényleges AI-ügynöki feldolgozást végzi, és a Bot workspace mappájában fut. |
