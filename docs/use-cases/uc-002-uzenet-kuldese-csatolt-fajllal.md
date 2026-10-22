---
id: uc-002
title: "UC-002 — Üzenet küldése az agentnek, csatolt fájllal"
type: use-case
version: 0.1.0
created: 2026-10-19
updated: 2026-10-19
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
  - architecture-c3-bot-workspace
---

1. **Name:** Üzenet küldése az agentnek, csatolt fájllal

2. **Goal / short description:** A felhasználó szöveges üzenetet — opcionálisan egy vagy több,
   drag&drop-pal vagy vágólapról csatolt fájllal — küld a kiválasztott bot agentjének, és a
   választ a chat-felületen kapja vissza.
   - **2.1 Precondition:** Van kiválasztott, futó bot.
   - **2.2 Exclusions:** Nem részletezi a csatolmány-chip UI-interakcióját (ld. UI design
     szabályzat) — csak az üzenet- és fájl-adatfolyamot a kattintástól a válaszig.

3. **Actors:** Primary: felhasználó. Secondary: `BotSession`/`WebViewBridge`, `claude.exe`
   (Claude Code CLI session), bot workspace.

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó szöveget ír és/vagy fájlt csatol a ChatInput-ba"]
    B --> C["Felhasználó elküldi az üzenetet"]
    C --> D["React UI optimistán megjeleníti a user-buborékot"]
    D --> E["BridgeClient elküldi a sendPrompt parancsot (szöveg + Base64-csatolmányok)"]
    E --> F["WebViewBridge lementi a csatolmányokat a bot workspace-mappájába"]
    F --> G["BotSession összeállítja a promptot (@fájlnév hivatkozásokkal) és beírja a claude.exe stdin-jére"]
    G --> H["claude.exe feldolgozza a promptot (Anthropic API hívás)"]
    H --> I["BotSession kiolvassa és értelmezi a stdout választ"]
    I --> J["WebViewBridge továbbítja a választ a React UI-nak"]
    J --> K["ChatView megjeleníti az assistant-buborékot"]
    K --> L(["End"])
```

5. **Potential errors:** Egy csatolmány mentése sikertelen → hibaüzenet a chatben, a többi
   csatolmány/üzenet feldolgozása folytatódik; a kiválasztott bot `claude.exe` folyamata nem fut
   → a prompt nem kerül elküldésre, hibaüzenet jelenik meg.

6. **Expected outcome:** A chat history tartalmazza a felhasználó üzenetét (csatolmány-jelzéssel
   együtt) és az agent válaszát; minden csatolt fájl ténylegesen bekerül a bot workspace
   mappájába, és a claude.exe ténylegesen hivatkozott rá a feldolgozás során.
