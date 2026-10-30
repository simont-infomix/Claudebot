---
id: uc-009
title: "UC-009 — Bot engedélyezett tool-jainak szabályozása"
type: use-case
version: 0.2.0
created: 2026-10-26
updated: 2026-10-30
references:
  - uc-018
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
---

1. **Name:** Bot engedélyezett tool-jainak szabályozása

2. **Goal / short description:** A felhasználó a Settings lap "Képességek" fülén be- vagy
   kikapcsolja, mely MCP-szerverek tool-jait használhatja a bot **előzetes jóváhagyás nélkül**.
   Az itt engedélyezett tool-ok futásidőben nem váltanak ki kérdést; a listából kimaradó
   hívásokra a bot — ha az interaktív jóváhagyás be van kapcsolva — esetenként rákérdez,
   egyébként azok elutasításra kerülnek.
   - **2.1 Precondition:** Van kiválasztott bot, a Settings lap "Képességek" fülén áll.
   - **2.2 Exclusions:** Ezen a fülön nem lehet natív tool-t (pl. Bash) felvenni — azok tartós
     engedélyezése a futásidejű jóváhagyó kártya "Mindig engedélyezd" gombjával történik.
     A sub agent-ek/skill-ek karbantartása sem tartozik ide: azok csak információs listaként
     jelennek meg, szerkesztés nélkül.

3. **Actors:** Primary: felhasználó. Secondary: `BotSessionManager` (`ApplySettings`),
   `claude.exe` (`--allowedTools`).

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó megnyitja a Settings lap Képességek fülét"]
    B --> C["Megjelenik minden ismert tool-minta chipként: zöld/kitöltött, ha engedélyezett, szaggatott, ha nem"]
    C --> D["Felhasználó egy chipre kattint, ami átváltja annak engedélyezett/nem engedélyezett állapotát"]
    D --> E["Megjelenik a Mentés gomb, mert a draft eltér a mentett állapottól"]
    E --> F["Felhasználó a Mentés gombra kattint"]
    F --> G["BridgeClient elküldi a saveSettings parancsot a frissített allowedTools listával"]
    G --> H["BotSessionManager elmenti a listát, majd újraindítja a claude.exe-t az új --allowedTools flaggel"]
    H --> I(["End"])
```

5. **Potential errors:** –

6. **Expected outcome:** A bot a mentés után csak az engedélyezett minták alá eső tool-okat
   érheti el kérdés nélkül; minden más tool-hívásnál a felhasználó futásidőben dönt, vagy —
   kikapcsolt interaktív jóváhagyás mellett — a hívás elutasításra kerül.
