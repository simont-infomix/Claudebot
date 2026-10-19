---
id: architecture-c3-react-ui
title: Architektúra diagram — C3 (Component) – React UI
type: architecture-c3
version: 0.1.0
created: 2026-10-15
updated: 2026-10-15
references:
  - architecture-c2-claude-bot
---

## Leírás

A React UI három belső komponensből áll: a bal oldali bot-választó sáv, a kiválasztott bot élő
logját és a hozzá tartozó műveleteket (terminál nyitása, beállítások-gomb) megjelenítő nézet, és a
WebView2 JS API-ját egyszerű függvényekre csomagoló híd-kliens. A beállítások nézet tartalma még
nincs kidolgozva — jelenleg csak egy funkció nélküli gomb jelzi a helyét.

## Diagram

```mermaid
C4Component
    title ClaudeBot — React UI

    Container(winformsHost, "WinForms Host", ".NET WinForms")

    Container_Boundary(reactUi, "React UI") {
        Component(sidebar, "Sidebar", "React komponens", "Bot-avatarok listája és az új bot létrehozása (+) gomb")
        Component(logView, "LogView", "React komponens", "A kiválasztott bot élő logja, a terminál-megnyitás és a (még inaktív) beállítások-gomb")
        Component(bridgeClient, "BridgeClient", "TypeScript wrapper a window.chrome.webview köré", "Tipizált függvényekre csomagolja a JS bridge üzenetváltást")
    }

    Rel(sidebar, bridgeClient, "Új bot létrehozása / bot kiválasztása")
    Rel(logView, bridgeClient, "Terminál megnyitása a kiválasztott bothoz")
    Rel(bridgeClient, winformsHost, "postMessage (parancsok)")
    Rel(winformsHost, bridgeClient, "PostWebMessageAsJson (bot-lista, log-események)")
    Rel(bridgeClient, sidebar, "Bot-lista frissítése")
    Rel(bridgeClient, logView, "Új log-sorok push-olása")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| Sidebar | Component | A bal oldali sáv: egy kör alakú avatar-gomb botonként, legalul a "+" gomb új bot létrehozásához. |
| LogView | Component | A kiválasztott bot élő log-területe, a terminál-megnyitás ("Open") és a jelenleg funkció nélküli beállítások-gomb. |
| BridgeClient | Component | A `window.chrome.webview.postMessage`/`addEventListener('message')` API-t tipizált, Promise-alapú függvényekre csomagoló kliensréteg; ezen keresztül éri el mind a Sidebar, mind a LogView a WinForms Host-ot. |
