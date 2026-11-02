---
id: architecture-c3-winforms-host
title: Architektúra diagram — C3 (Component) – WinForms Host
type: architecture-c3
version: 0.3.0
created: 2026-10-15
updated: 2026-11-02
references:
  - architecture-c2-claude-bot
  - decision-01
  - decision-04
  - decision-05
---

## Leírás

A WinForms Host hat belső komponensből áll: a bot-session-ök felügyeletéért felelős menedzser, a
futó `claude.exe` subprocess egy-egy példányát becsomagoló session-objektum, az időzített
feladatokat pollozó ütemező (ADR-0001), a WebView2 JavaScript-hídját kezelő réteg, ami a React
UI felé/felől fordítja az üzeneteket, valamint a botok közti üzenetváltást megvalósító busz és az
azt a botok felé kiajánló MCP szerver (ADR-0005).

A `BotSession` a tool-jóváhagyási kérések (ADR-0004) élettartamát is birtokolja: ezek a kérések
kizárólag az őt kiállító `claude.exe` példányon belül értelmesek, ezért a nyilvántartásuk ugyanott
él, ahol a folyamat maga — nem a menedzserben vagy a hídban, amik állapotmentesek maradnak.

A bot-csatorna két komponensre bomlik, mert két különböző dolgot csinálnak: a `ChannelMcpServer` a
*transzport* (HTTP-végpont a loopbacken, és a hívó bot azonosítása az URL tokenjéből), a
`BotMessageBus` pedig a *szabályok* helye (kézbesítés, címzett-feloldás, lánc-mélység és
darabszám-korlát). A kettő indítási sorrendje kötött: a szervernek a botok indulása előtt kell
élnie — a `claude.exe` a végpont címét csak induláskor kapja meg —, a busz viszont csak a menedzser
létrejötte után képződhet, ezért utólag kerül a szerverbe.

## Diagram

```mermaid
C4Component
    title ClaudeBot — WinForms Host

    Container(reactUi, "React UI", "React, WebView2")
    ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer")
    Container(claudeSession, "Claude Code CLI session", "claude.exe, headless")

    Container_Boundary(winformsHost, "WinForms Host") {
        Component(webViewBridge, "WebViewBridge", "WebView2 CoreWebView2 API", "A JS postMessage/PostWebMessageAsJson csatornát fordítja a belső komponensek felé/felől")
        Component(botSessionManager, "BotSessionManager", "C#", "Nyilvántartja a futó botokat; induláskor visszaolvassa a meglévő bot-mappákat, kezeli az új bot létrehozását")
        Component(botSession, "BotSession", "C#, System.Diagnostics.Process", "Egy darab claude.exe subprocess életciklusa: indítás, stdin JSON-írás, stdout JSON-olvasás/parse, leállítás, tool-jóváhagyási kérések nyilvántartása")
        Component(scheduler, "BotTaskScheduler", "C#, System.Windows.Forms.Timer", "Botonkénti időzített feladatok pollozása és kiváltása (ADR-0001)")
        Component(channelServer, "ChannelMcpServer", "C#, Kestrel + ModelContextProtocol.AspNetCore", "A bot-csatorna MCP végpontja a loopbacken, botonkénti titkos tokennel; a hívó bot kiléte az URL-ből derül ki (ADR-0005)")
        Component(messageBus, "BotMessageBus", "C#", "A botok közös üzenet-busza: címzett-feloldás, kézbesítés, lánc-mélység és darabszám-korlát, csatorna-előzmény")
    }

    Rel(reactUi, webViewBridge, "JS bridge: postMessage")
    Rel(webViewBridge, reactUi, "JS bridge: PostWebMessageAsJson")
    Rel(webViewBridge, botSessionManager, "Parancsok továbbítása (pl. új bot létrehozása, terminál nyitása, jóváhagyási válasz)")
    Rel(botSessionManager, botSession, "Létrehozza/indítja/leállítja (botonként egy példány)")
    Rel(botSessionManager, botWorkspace, "Mappa létrehozása, meglévő botok felsorolása")
    Rel(botSession, botWorkspace, "WorkingDirectory")
    Rel(scheduler, botSession, "Időzített prompt-küldés")
    Rel(claudeSession, channelServer, "MCP tool-hívás HTTP-n (list_bots, send_message, recent_messages)")
    Rel(channelServer, messageBus, "A tool-hívások kiszolgálása")
    Rel(messageBus, botSession, "Kézbesítés: prompt-küldés a címzett botnak, csatorna-sor a küldő csevegésébe")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| WebViewBridge | Component | A WebView2 `WebMessageReceived`/`PostWebMessageAsJson` csatornáját JSON-üzenetekre fordítja a React UI és a belső komponensek között. |
| BotSessionManager | Component | A bot-lista kezelése: induláskor a `Bots` mappa almappáiból visszaállítja a botokat, új bot létrehozásakor mappát hoz létre és elindítja a session-t. |
| BotSession | Component | A jelenlegi implementáció központi eleme: egy `claude.exe` subprocess indítása (`-p --input-format stream-json --output-format stream-json --verbose`), a stdin/stdout JSON-sorok kezelése, leállítás. A tool-jóváhagyási kérések (ADR-0004) élettartamát is ez birtokolja: a kérés válaszáig vagy a folyamat leállásáig tartja nyilván, és egyetlen zárolt metóduson keresztül ír a stdin-re, hogy a több szálról (UI-szál, lejárati időzítő, kimenet-olvasó szál) érkező válaszok ne keveredjenek össze. |
| BotTaskScheduler | Component | 30 másodpercenként pollozva indítja az esedékes feladatokat (ADR-0001); egy jóváhagyásra váró, válasz nélkül maradt kör esetén a futást sikertelenként zárja le, nem hagyja korlátlanul "folyamatban" állapotban. |
| ChannelMcpServer | Component | A bot-csatorna transzportja (ADR-0005): in-process Kestrel, kizárólag a loopbacken, dinamikus porton. Botonként külön, titkos tokenű végpontot szolgál ki — ebből azonosítja a hívót, ismeretlen tokenre 404-gyel válaszol. A botok három eszközt látnak rajta: `list_bots`, `send_message`, `recent_messages`. |
| BotMessageBus | Component | A csatorna szabályai egy helyen: feloldja a címzetteket (ismeretlen, önmaga, nem futó vagy a csatornáról kikapcsolt bot kimarad, indoklással), kézbesít a címzettek session-jének, vezeti a válasz-láncok mélységét és a botonkénti darabszám-korlátot, és megtartja az utolsó üzeneteket utólagos felzárkózáshoz. A kézbesítés szándékosan a belső zároláson kívül fut, mert UI-szálra marshalolódó eseményeket vált ki. |
