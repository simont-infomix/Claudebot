---
id: uc-009
title: "UC-009 — Bot engedélyezett tool-jainak szabályozása"
type: use-case
version: 0.1.0
created: 2026-10-26
updated: 2026-10-26
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
---

1. **Name:** Bot engedélyezett tool-jainak szabályozása

2. **Goal / short description:** A felhasználó a Settings lap "Képességek" fülén be- vagy
   kikapcsolja, mely MCP-szerverek tool-jait használhatja automatikusan a bot headless módban —
   mivel a `claude.exe` headless futásnál nincs felugró jóváhagyás, enélkül minden nem explicit
   engedélyezett tool-hívás némán elutasításra kerülne.
   - **2.1 Precondition:** Van kiválasztott bot, a Settings lap "Képességek" fülén áll.
   - **2.2 Exclusions:** Nem ad lehetőséget natív tool-ok (pl. Bash) engedélyezésére, és nem
     tartalmazza a sub agent-ek/skill-ek karbantartását — azok ezen a fülön csak információs
     listaként jelennek meg, szerkesztés nélkül.

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
   érheti el automatikusan; minden más tool-hívás továbbra is elutasításra kerül.
