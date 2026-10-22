---
id: uc-003
title: "UC-003 — Bot terminál-munkamenetének megnyitása"
type: use-case
version: 0.2.0
created: 2026-10-19
updated: 2026-10-19
references:
  - architecture-c3-winforms-host
  - architecture-c3-bot-workspace
---

1. **Name:** Bot terminál-munkamenetének megnyitása

2. **Goal / short description:** A felhasználó egy natív konzolablakot nyit a kiválasztott bot
   workspace-mappájában, hogy közvetlenül, interaktívan használja a `claude` CLI-t, a chat-UI-tól
   függetlenül.
   - **2.1 Precondition:** Van kiválasztott bot.
   - **2.2 Exclusions:** Nem szünetelteti és nem helyettesíti a chat-UI mögött futó
     `BotSession`-t — a kettő egymástól független, párhuzamosan él.

3. **Actors:** Primary: felhasználó. Secondary: `BotSessionManager`, operációs rendszer
   (`cmd.exe`).

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó jobbklikkel a bot avatarjára a Sidebar-ban"]
    B --> C["Megjelenik a bot kontextusmenüje"]
    C --> D["Felhasználó kiválasztja: 'Bot megnyitása Terminálban'"]
    D --> E["BridgeClient elküldi az openTerminal parancsot a WinForms Hostnak"]
    E --> F["BotSessionManager elindít egy cmd.exe /K claude folyamatot a bot workspace-mappájában"]
    F --> G["Megnyílik egy önálló, natív konzolablak"]
    G --> H["Felhasználó interaktívan használja a claude CLI-t"]
    H --> I(["End"])
```

5. **Potential errors:** A `cmd.exe`/`claude` folyamat indítása sikertelen (pl. a `claude` nem
   található a PATH-on) → hibaüzenet jelenik meg a chat-felületen, nem nyílik konzolablak.

6. **Expected outcome:** Egy önálló, natív terminálablak fut a bot workspace-mappájában, a
   chat-UI-n futó session-től függetlenül, azzal párhuzamosan.
