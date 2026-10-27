---
id: uc-006
title: "UC-006 — Bot beállításainak gyors elérése a jobbklikk menüből"
type: use-case
version: 0.1.0
created: 2026-10-26
updated: 2026-10-26
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
---

1. **Name:** Bot beállításainak gyors elérése a jobbklikk menüből

2. **Goal / short description:** A felhasználó a Sidebar-ban egy bot avatarjára jobbklikkelve
   közvetlenül a Settings lap kívánt fülére (Beállítások / Bot definíció / Képességek /
   Feladatok) navigál, anélkül hogy előbb meg kellene nyitnia a lapot és kézzel kiválasztania a
   fület.
   - **2.1 Precondition:** Van legalább egy bot a Sidebar-ban.
   - **2.2 Exclusions:** Nem tárgyalja a Settings lap egyes füleinek tartalmát és az ottani
     szerkesztést — ezeket a UC-008, UC-009 és UC-010 fedi le.

3. **Actors:** Primary: felhasználó. Secondary: `WebViewBridge`, `BotSessionManager`.

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó jobbklikkel egy bot avatarjára a Sidebar-ban"]
    B --> C["Megjelenik a bot kontextusmenüje a 4 gyors-link opcióval"]
    C --> D["Felhasználó kiválasztja az egyiket: Beállítások / Bot definíció / Képességek / Feladatok"]
    D --> E["A React UI kijelöli az adott botot és beállítja az aktív tab-ot"]
    E --> F["BridgeClient elküldi a getBotDetails parancsot (agent.md, skill-/sub agent-lista)"]
    F --> G["Megnyílik a Settings lap, rögtön a kiválasztott fülre ugorva"]
    G --> H(["End"])
```

5. **Potential errors:** –

6. **Expected outcome:** A Settings lap nyitva van, az aktív fül pontosan az, amit a felhasználó
   a kontextusmenüből kiválasztott.
