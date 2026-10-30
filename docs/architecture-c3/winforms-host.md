---
id: architecture-c3-winforms-host
title: Architektúra diagram — C3 (Component) – WinForms Host
type: architecture-c3
version: 0.2.0
created: 2026-10-15
updated: 2026-10-30
references:
  - architecture-c2-claude-bot
  - decision-01
  - decision-04
---

## Leírás

A WinForms Host négy belső komponensből áll: a bot-session-ök felügyeletéért felelős menedzser, a
futó `claude.exe` subprocess egy-egy példányát becsomagoló session-objektum, az időzített
feladatokat pollozó ütemező (ADR-0001), és a WebView2 JavaScript-hídját kezelő réteg, ami a React
UI felé/felől fordítja az üzeneteket.

A `BotSession` a tool-jóváhagyási kérések (ADR-0004) élettartamát is birtokolja: ezek a kérések
kizárólag az őt kiállító `claude.exe` példányon belül értelmesek, ezért a nyilvántartásuk ugyanott
él, ahol a folyamat maga — nem a menedzserben vagy a hídban, amik állapotmentesek maradnak.

## Diagram

```mermaid
C4Component
    title ClaudeBot — WinForms Host

    Container(reactUi, "React UI", "React, WebView2")
    ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer")

    Container_Boundary(winformsHost, "WinForms Host") {
        Component(webViewBridge, "WebViewBridge", "WebView2 CoreWebView2 API", "A JS postMessage/PostWebMessageAsJson csatornát fordítja a belső komponensek felé/felől")
        Component(botSessionManager, "BotSessionManager", "C#", "Nyilvántartja a futó botokat; induláskor visszaolvassa a meglévő bot-mappákat, kezeli az új bot létrehozását")
        Component(botSession, "BotSession", "C#, System.Diagnostics.Process", "Egy darab claude.exe subprocess életciklusa: indítás, stdin JSON-írás, stdout JSON-olvasás/parse, leállítás, tool-jóváhagyási kérések nyilvántartása")
        Component(scheduler, "BotTaskScheduler", "C#, System.Windows.Forms.Timer", "Botonkénti időzített feladatok pollozása és kiváltása (ADR-0001)")
    }

    Rel(reactUi, webViewBridge, "JS bridge: postMessage")
    Rel(webViewBridge, reactUi, "JS bridge: PostWebMessageAsJson")
    Rel(webViewBridge, botSessionManager, "Parancsok továbbítása (pl. új bot létrehozása, terminál nyitása, jóváhagyási válasz)")
    Rel(botSessionManager, botSession, "Létrehozza/indítja/leállítja (botonként egy példány)")
    Rel(botSessionManager, botWorkspace, "Mappa létrehozása, meglévő botok felsorolása")
    Rel(botSession, botWorkspace, "WorkingDirectory")
    Rel(scheduler, botSession, "Időzített prompt-küldés")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| WebViewBridge | Component | A WebView2 `WebMessageReceived`/`PostWebMessageAsJson` csatornáját JSON-üzenetekre fordítja a React UI és a belső komponensek között. |
| BotSessionManager | Component | A bot-lista kezelése: induláskor a `Bots` mappa almappáiból visszaállítja a botokat, új bot létrehozásakor mappát hoz létre és elindítja a session-t. |
| BotSession | Component | A jelenlegi implementáció központi eleme: egy `claude.exe` subprocess indítása (`-p --input-format stream-json --output-format stream-json --verbose`), a stdin/stdout JSON-sorok kezelése, leállítás. A tool-jóváhagyási kérések (ADR-0004) élettartamát is ez birtokolja: a kérés válaszáig vagy a folyamat leállásáig tartja nyilván, és egyetlen zárolt metóduson keresztül ír a stdin-re, hogy a több szálról (UI-szál, lejárati időzítő, kimenet-olvasó szál) érkező válaszok ne keveredjenek össze. |
| BotTaskScheduler | Component | 30 másodpercenként pollozva indítja az esedékes feladatokat (ADR-0001); egy jóváhagyásra váró, válasz nélkül maradt kör esetén a futást sikertelenként zárja le, nem hagyja korlátlanul "folyamatban" állapotban. |
