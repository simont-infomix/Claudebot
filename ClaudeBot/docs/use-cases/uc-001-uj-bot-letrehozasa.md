---
id: uc-001
title: "UC-001 — Új bot (agent-session) létrehozása"
type: use-case
version: 0.1.0
created: 2026-10-19
updated: 2026-10-19
references:
  - architecture-c3-winforms-host
  - architecture-c3-bot-workspace
---

1. **Name:** Új bot (agent-session) létrehozása

2. **Goal / short description:** A felhasználó a Sidebar "+" gombjával új botot hoz létre, aminek
   saját workspace-mappája és saját, futó `claude.exe` agent-session-je lesz.
   - **2.1 Precondition:** A ClaudeBotApp fut (WinForms Host + React UI inicializálva).
   - **2.2 Exclusions:** Nem tartalmazza a `claude.exe` CLI telepítését, sem a bot workspace
     tartalmának (skillek, agent-configok) utólagos, kézi feltöltését.

3. **Actors:** Primary: felhasználó. Secondary: `BotSessionManager`, `BotSession` (a `claude.exe`
   subprocess felügyelője).

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó a Sidebar '+' gombjára kattint"]
    B --> C["Megjelenik a NewBotDialog, mezője: bot neve"]
    C --> D["Felhasználó beírja a nevet és megerősíti (OK)"]
    D --> E["BridgeClient elküldi a createBot parancsot a WinForms Hostnak"]
    E --> F{"A név érvényes és egyedi?"}
    F -- "Nem" --> G["Hibaüzenet a dialógusban, a dialógus nyitva marad"]
    F -- "Igen" --> H["BotSessionManager létrehozza a bot workspace-mappáját"]
    H --> I["BotSession elindítja a claude.exe subprocesst a mappában"]
    I --> J["Frissül a bot-lista, a Sidebar megjeleníti az új avatart 'fut' állapotban"]
    J --> K(["End"])
```

5. **Potential errors:** A megadott név üres, érvénytelen fájlnév-karaktert tartalmaz, vagy már
   létező bot neve → inline hibaüzenet a dialógusban, nincs mappa- vagy session-létrehozás; a
   `claude.exe` indítása sikertelen → a bot létrejön, de "hiba" állapotba kerül, a hiba naplózódik.

6. **Expected outcome:** Az új bot megjelenik a Sidebar-ban, saját almappával a bot workspace-ek
   gyökerében, és egy élő `claude.exe` session áll mögötte, készen üzenet fogadására.
