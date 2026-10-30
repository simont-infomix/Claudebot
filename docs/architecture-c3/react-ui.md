---
id: architecture-c3-react-ui
title: Architektúra diagram — C3 (Component) – React UI
type: architecture-c3
version: 0.3.0
created: 2026-10-15
updated: 2026-10-30
references:
  - architecture-c2-claude-bot
  - decision-04
---

## Leírás

A React UI négy belső komponensből áll: a bal oldali bot-választó sáv, a kiválasztott bot
beszélgetését buborékokban megjelenítő chat-nézet, egy önálló, bővíthető beviteli komponens (a
chat-nézeten belül), és a WebView2 JS API-ját egyszerű függvényekre csomagoló híd-kliens. A
beállítások nézet tartalma még nincs kidolgozva — jelenleg csak egy funkció nélküli gomb jelzi a
helyét.

## Diagram

```mermaid
C4Component
    title ClaudeBot — React UI

    Container(winformsHost, "WinForms Host", ".NET WinForms")

    Container_Boundary(reactUi, "React UI") {
        Component(sidebar, "Sidebar", "React komponens", "Bot-avatarok listája és az új bot létrehozása (+) gomb")
        Component(chatView, "ChatView", "React komponens", "A kiválasztott bot beszélgetése buborékokban, a terminál-megnyitás és a (még inaktív) beállítások-gomb")
        Component(chatInput, "ChatInput", "React komponens", "Önálló beviteli sáv: szövegmező + küldés-gomb, Enter-rel is küldhető")
        Component(permissionCard, "PermissionCard", "React komponens", "Tool-jóváhagyási kártya a chat folyamában: Engedélyezem / Mindig engedélyezd / Elutasítom (ADR-0004)")
        Component(bridgeClient, "BridgeClient", "TypeScript wrapper a window.chrome.webview köré", "Tipizált függvényekre csomagolja a JS bridge üzenetváltást")
    }

    Rel(sidebar, bridgeClient, "Új bot létrehozása / bot kiválasztása")
    Rel(chatView, bridgeClient, "Terminál megnyitása a kiválasztott bothoz")
    Rel(chatInput, chatView, "Elküldött szöveg (onSend callback)")
    Rel(chatView, bridgeClient, "Prompt küldése a kiválasztott botnak")
    Rel(chatView, permissionCard, "Függő jóváhagyási kérések megjelenítése a beszélgetés helyén")
    Rel(permissionCard, bridgeClient, "Jóváhagyási döntés (allow / allowAlways / deny)")
    Rel(bridgeClient, winformsHost, "postMessage (parancsok)")
    Rel(winformsHost, bridgeClient, "PostWebMessageAsJson (bot-lista, chat-események)")
    Rel(bridgeClient, sidebar, "Bot-lista frissítése")
    Rel(bridgeClient, chatView, "Új chat-üzenetek push-olása")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| Sidebar | Component | A bal oldali sáv: egy kör alakú avatar-gomb botonként, legalul a "+" gomb új bot létrehozásához. |
| ChatView | Component | A kiválasztott bot beszélgetése: a user üzenetei jobbra, a bot válaszai balra igazított buborékokban; a terminál-megnyitás ("Open") és a jelenleg funkció nélküli beállítások-gomb a tetején; a ChatInput-ot ágyazza be alulra. |
| ChatInput | Component | Önálló komponens (nem a ChatView JSX-ébe írt beviteli mező), hogy a jövőbeli bővítések (pl. csatolmányok, parancsok) ne a ChatView-t érintsék. Szövegmező + küldés-gomb; `Enter` küld, `Shift+Enter` új sort kezd. |
| PermissionCard | Component | A bot egy nem engedélyezett eszközt kér — a kártya a beszélgetés időrendi helyén jelenik meg (nem modálisan), így nem blokkolja a felületet, és több bot függő kérése is megfér egymás mellett. Állapota (pending/allowed/denied/timedOut/cancelled) a válasz vagy a lejárat után is megmarad a chat-folyamban. |
| BridgeClient | Component | A `window.chrome.webview.postMessage`/`addEventListener('message')` API-t tipizált, Promise-alapú függvényekre csomagoló kliensréteg; ezen keresztül éri el mind a Sidebar, mind a ChatView a WinForms Host-ot. |
