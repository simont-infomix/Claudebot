---
id: uc-008
title: "UC-008 — Bot futási beállításainak (model/effort/permission mode) módosítása"
type: use-case
version: 0.1.0
created: 2026-10-26
updated: 2026-10-26
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
---

1. **Name:** Bot futási beállításainak (model/effort/permission mode) módosítása

2. **Goal / short description:** A felhasználó a Settings lap "Beállítások" fülén módosítja,
   melyik modellt, milyen effort-szinttel és milyen engedélyezési móddal futtassa a bot
   `claude.exe` session-je, majd a mentéskor a bot automatikusan újraindul az új beállításokkal.
   - **2.1 Precondition:** Van kiválasztott bot, a Settings lap "Beállítások" fülén áll.
   - **2.2 Exclusions:** Nem tárgyalja a tool-engedélyek (UC-009) és az ütemezett feladatok
     (UC-010) szerkesztését, bár technikailag ugyanaz a Mentés gomb viszi át mindhármat.

3. **Actors:** Primary: felhasználó. Secondary: `BotSessionManager` (`ApplySettings`),
   `BotSession` (újraindítás), `claude.exe`.

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó megnyitja a Settings lap Beállítások fülét"]
    B --> C["Felhasználó módosítja a Model/Effort/Permission mode legördülőket"]
    C --> D["Megjelenik a Mentés gomb, mert a draft eltér a mentett állapottól"]
    D --> E["Felhasználó a Mentés gombra kattint"]
    E --> F["BridgeClient elküldi a saveSettings parancsot"]
    F --> G["BotSessionManager elmenti az új értékeket a .bot-meta.json-ba"]
    G --> H["BotSessionManager leállítja, majd újraindítja a claude.exe-t az új --model/--effort/--permission-mode flagekkel"]
    H --> I["A Mentés gomb eltűnik, a draft megegyezik a mentett állapottal"]
    I --> J(["End"])
```

5. **Potential errors:** A mentés közben a bot neve ütközik egy másik bottal (csak akkor
   releváns, ha a névmező is módosult) → hibaüzenet a Settings lapon, a módosítások nem vesznek
   el, újra menthető.

6. **Expected outcome:** A bot ezentúl a kiválasztott modellel, effort-szinttel és permission
   móddal fut; a beállítás a `.bot-meta.json`-ban perzisztálva marad az app újraindítása után is.
