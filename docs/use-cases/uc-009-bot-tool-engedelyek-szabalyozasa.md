---
id: uc-009
title: "UC-009 — Bot engedélyezett tool-jainak szabályozása"
type: use-case
version: 0.3.0
created: 2026-10-26
updated: 2026-11-02
references:
  - uc-018
  - uc-021
  - decision-05
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
   Ugyanezen a fülön, az MCP-szerverek között kapcsolható a bot részvétele a közös bot-csatornán
   is (UC-021) — a felhasználó felé ugyanaz a kérdés ("használhatja-e ezt a bot"), a hatása
   viszont azonnali: ez a kapcsoló nem indítja újra a botot, így a beszélgetés kontextusa megmarad.
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

5. **Potential errors:** A bot-csatorna chipje kivétel az utolsó lépés alól: azt a hoszt
   futásidőben érvényesíti, ezért a mentése nem jár újraindítással — ha a felhasználó egyszerre
   módosít tool-mintát és csatorna-részvételt, az újraindítást a tool-minta váltja ki, nem a
   csatorna.

6. **Expected outcome:** A bot a mentés után csak az engedélyezett minták alá eső tool-okat
   érheti el kérdés nélkül; minden más tool-hívásnál a felhasználó futásidőben dönt, vagy —
   kikapcsolt interaktív jóváhagyás mellett — a hívás elutasításra kerül.
