---
id: architecture-c3-claude-code-cli-session
title: Architektúra diagram — C3 (Component) – Claude Code CLI session
type: architecture-c3
version: 0.3.0
created: 2026-10-15
updated: 2026-11-02
references:
  - architecture-c2-claude-bot
  - decision-04
  - decision-05
---

## Leírás

Ez a container nem bontható tovább komponensekre — a `claude.exe` egy külső, zárt futtatható
(Anthropic Claude Code CLI), aminek nincs saját forráskódunk vagy komponens-bontásunk róla.
Feketedobozként kezelendő a ClaudeBot architektúrája szempontjából.

A stdin/stdout interfész-szerződése egyirányúból **kétirányúvá** bővült (ADR-0004): a
`claude.exe` a stdout-ra immár nemcsak beszélgetés-eseményeket ír, hanem — a
`--permission-prompt-tool stdio` kapcsoló mellett — tool-jóváhagyási control-kéréseket is, és a
stdin-en ugyanilyen control-válaszokat vár vissza. Ez a csatorna nem a nyilvánosan dokumentált
felülete a CLI-nek; a sémáját a WinForms Host a telepített bináris elemzésével és éles méréssel
derítette fel.

A session a stdin/stdout mellett egy **harmadik** irányban is kapcsolódik a hoszthoz (ADR-0005):
induláskor egy inline `--mcp-config` kapcsolóval megkapja a hoszt bot-csatorna MCP szerverének
saját, titkos végpontját, és azon keresztül HTTP-n hívhatja a csatorna eszközeit. Ez az egyetlen
út, amin a `claude.exe` **kezdeményezni** tud a hoszt felé — a stdout-folyam leíró, a
control-protokollon pedig a hoszt kérdez.

## Diagram

```mermaid
C4Component
    title ClaudeBot — Claude Code CLI session

    ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer")
    System_Ext(anthropicApi, "Anthropic Claude API")
    Container(winformsHost, "WinForms Host", ".NET WinForms")

    Container_Boundary(claudeSession, "Claude Code CLI session") {
        Component(claudeExe, "claude.exe", "Anthropic Claude Code CLI (headless, stream-json)", "A teljes AI-ügynöki feldolgozás; a WinForms Host subprocess-ként indítja és stdin/stdout JSON-sorokon keresztül kommunikál vele")
    }

    Rel(claudeExe, botWorkspace, "WorkingDirectory: skill-ek/agent-configok olvasása, fájlműveletek")
    Rel(claudeExe, anthropicApi, "API-hívások")
    Rel(claudeExe, winformsHost, "stdout: control_request (can_use_tool) — nem engedélyezett eszköz jóváhagyása")
    Rel(winformsHost, claudeExe, "stdin: control_response (allow/deny, opcionálisan session-szabállyal)")
    Rel(claudeExe, winformsHost, "MCP tool-hívás HTTP-n a bot-csatorna végpontjára (ADR-0005)")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| claude.exe | Component | Az egyetlen elem ebben a container-ben; nincs belső komponens-struktúránk róla, mert ez egy külső, zárt futtatható. |
