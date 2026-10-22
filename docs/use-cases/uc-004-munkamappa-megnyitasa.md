---
id: uc-004
title: "UC-004 — Bot munkamappájának megnyitása Intézőben"
type: use-case
version: 0.1.0
created: 2026-10-19
updated: 2026-10-19
references:
  - architecture-c3-winforms-host
  - architecture-c3-bot-workspace
---

1. **Name:** Bot munkamappájának megnyitása Intézőben

2. **Goal / short description:** A felhasználó a kiválasztott bot workspace-mappáját natív
   Windows Intézőben (Explorer) nyitja meg, hogy közvetlenül hozzáférjen a bot fájljaihoz
   (skillek, agent-configok, a chaten keresztül csatolt fájlok).
   - **2.1 Precondition:** Van kiválasztott bot.
   - **2.2 Exclusions:** Nem helyettesíti a terminál-munkamenetet (ld. UC-003) — ez kizárólag
     fájlkezelő nézetet nyit, nem indít CLI-interakciót.

3. **Actors:** Primary: felhasználó. Secondary: `BotSessionManager`, operációs rendszer
   (`explorer.exe`).

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó jobbklikkel a bot avatarjára a Sidebar-ban"]
    B --> C["Megjelenik a bot kontextusmenüje"]
    C --> D["Felhasználó kiválasztja: 'Munka mappa megnyitása'"]
    D --> E["BridgeClient elküldi az openWorkspaceFolder parancsot a WinForms Hostnak"]
    E --> F["BotSessionManager elindítja az explorer.exe-t a bot workspace-mappájával"]
    F --> G["Megnyílik egy Intéző-ablak a mappa tartalmával"]
    G --> H(["End"])
```

5. **Potential errors:** Az `explorer.exe` indítása sikertelen → hibaüzenet jelenik meg a
   chat-felületen, nem nyílik Intéző-ablak.

6. **Expected outcome:** Egy natív Intéző-ablak mutatja a bot workspace-mappájának tartalmát, a
   chat-UI-tól és a terminál-munkamenettől függetlenül.
