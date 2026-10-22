---
id: architecture-c3-claude-code-cli-session
title: Architektúra diagram — C3 (Component) – Claude Code CLI session
type: architecture-c3
version: 0.1.0
created: 2026-10-15
updated: 2026-10-15
references:
  - architecture-c2-claude-bot
---

## Leírás

Ez a container nem bontható tovább komponensekre — a `claude.exe` egy külső, zárt futtatható
(Anthropic Claude Code CLI), aminek nincs saját forráskódunk vagy komponens-bontásunk róla.
Feketedobozként kezelendő a ClaudeBot architektúrája szempontjából.

## Diagram

```mermaid
C4Component
    title ClaudeBot — Claude Code CLI session

    ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer")
    System_Ext(anthropicApi, "Anthropic Claude API")

    Container_Boundary(claudeSession, "Claude Code CLI session") {
        Component(claudeExe, "claude.exe", "Anthropic Claude Code CLI (headless, stream-json)", "A teljes AI-ügynöki feldolgozás; a WinForms Host subprocess-ként indítja és stdin/stdout JSON-sorokon keresztül kommunikál vele")
    }

    Rel(claudeExe, botWorkspace, "WorkingDirectory: skill-ek/agent-configok olvasása, fájlműveletek")
    Rel(claudeExe, anthropicApi, "API-hívások")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| claude.exe | Component | Az egyetlen elem ebben a container-ben; nincs belső komponens-struktúránk róla, mert ez egy külső, zárt futtatható. |
