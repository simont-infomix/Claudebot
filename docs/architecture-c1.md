---
id: architecture-c1
title: Architektúra diagram — C1 (System Context)
type: architecture-c1
version: 0.1.0
created: 2026-10-15
updated: 2026-10-15
references: []
---

## Leírás

A rendszer egyetlen System-et tartalmaz a határon belül: a ClaudeBot Windows asztali alkalmazást.
Egy szereplő van (a felhasználó), és két külső rendszer: az Anthropic Claude API (amit a
`claude.exe` CLI ér el a háttérben), és a Microsoft 365 (Outlook/Teams), amit a jövőbeli
triázs-funkció (ld. UC-001, UC-002) fog elérni.

## Diagram

```mermaid
C4Context
    title ClaudeBot — System Context

    Person(user, "Felhasználó", "A ClaudeBot egyetlen, saját gépén dolgozó felhasználója")
    System(claudeBot, "ClaudeBot", "Windows asztali alkalmazás, amely egy vagy több AI-agentet (botot) futtat és felügyel")
    System_Ext(anthropicApi, "Anthropic Claude API", "A nyelvi modell, amit a claude.exe CLI ér el")
    System_Ext(m365, "Microsoft 365 (Outlook/Teams)", "Levelek és Teams-üzenetek — a jövőbeli triázs-funkcióhoz")

    Rel(user, claudeBot, "Használja: botok létrehozása, logok megtekintése, interaktív terminál nyitása")
    Rel(claudeBot, anthropicApi, "API-hívások a futtatott Claude Code session-ökön keresztül")
    Rel(claudeBot, m365, "Levelek/üzenetek lekérdezése (tervezett, MCP-n keresztül)")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| Felhasználó | Person | A ClaudeBot egyetlen, saját gépén dolgozó felhasználója. |
| ClaudeBot | System | A teljes Windows asztali alkalmazás, mint fekete doboz: bot-kezelés, subprocess-felügyelet, UI. |
| Anthropic Claude API | System_Ext | A nyelvi modell szolgáltatása, amit minden futó `claude.exe` session a háttérben elér. |
| Microsoft 365 (Outlook/Teams) | System_Ext | Levelezés/Teams, amit a tervezett önálló triázs-funkció (UC-001) fog elérni. |
