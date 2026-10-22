---
id: architecture-c3-bot-workspace
title: Architektúra diagram — C3 (Component) – Bot workspace
type: architecture-c3
version: 0.1.0
created: 2026-10-15
updated: 2026-10-15
references:
  - architecture-c2-claude-bot
---

## Leírás

Ez a container nem bontható tovább komponensekre — egy sima, a Windows fájlrendszer által kezelt
mappa botonként, saját logika nélkül. Feketedobozként kezelendő.

## Diagram

```mermaid
C4Component
    title ClaudeBot — Bot workspace

    Container_Boundary(botWorkspace, "Bot workspace") {
        Component(botFolder, "Bot-mappa", "Windows fájlrendszer", "Egy darab almappa botonként: a claude.exe munkakönyvtára, benne a skill-ek és agent-configok")
    }
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| Bot-mappa | Component | Az egyetlen elem ebben a container-ben; nincs belső komponens-struktúrája, a Windows fájlrendszer kezeli. |
