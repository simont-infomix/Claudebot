---
id: architecture-c3-winforms-host
title: Architektúra diagram — C3 (Component) – WinForms Host
type: architecture-c3
version: 0.1.0
created: 2026-10-15
updated: 2026-10-15
references:
  - architecture-c2-claude-bot
---

## Leírás

A WinForms Host négy belső komponensből áll: a bot-session-ök felügyeletéért felelős menedzser, a
futó `claude.exe` subprocess egy-egy példányát becsomagoló session-objektum, a (jelenleg még nem
implementált) időzített feladat-ütemező, és a WebView2 JavaScript-hídját kezelő réteg, ami a React
UI felé/felől fordítja az üzeneteket.

## Diagram

```mermaid
C4Component
    title ClaudeBot — WinForms Host

    Container(reactUi, "React UI", "React, WebView2")
    ContainerDb(botWorkspace, "Bot workspace", "Helyi fájlrendszer")

    Container_Boundary(winformsHost, "WinForms Host") {
        Component(webViewBridge, "WebViewBridge", "WebView2 CoreWebView2 API", "A JS postMessage/PostWebMessageAsJson csatornát fordítja a belső komponensek felé/felől")
        Component(botSessionManager, "BotSessionManager", "C#", "Nyilvántartja a futó botokat; induláskor visszaolvassa a meglévő bot-mappákat, kezeli az új bot létrehozását")
        Component(botSession, "BotSession", "C#, System.Diagnostics.Process", "Egy darab claude.exe subprocess életciklusa: indítás, stdin JSON-írás, stdout JSON-olvasás/parse, leállítás")
        Component(scheduler, "SchedulerService", "C# (tervezett)", "Botonkénti időzített feladatok nyilvántartása és kiváltása — még nincs implementálva")
    }

    Rel(reactUi, webViewBridge, "JS bridge: postMessage")
    Rel(webViewBridge, reactUi, "JS bridge: PostWebMessageAsJson")
    Rel(webViewBridge, botSessionManager, "Parancsok továbbítása (pl. új bot létrehozása, terminál nyitása)")
    Rel(botSessionManager, botSession, "Létrehozza/indítja/leállítja (botonként egy példány)")
    Rel(botSessionManager, botWorkspace, "Mappa létrehozása, meglévő botok felsorolása")
    Rel(botSession, botWorkspace, "WorkingDirectory")
    Rel(scheduler, botSession, "Időzített prompt-küldés (tervezett)")
```

## Elemek

| Elem | Típus | Leírás |
|---|---|---|
| WebViewBridge | Component | A WebView2 `WebMessageReceived`/`PostWebMessageAsJson` csatornáját JSON-üzenetekre fordítja a React UI és a belső komponensek között. |
| BotSessionManager | Component | A bot-lista kezelése: induláskor a `Bots` mappa almappáiból visszaállítja a botokat, új bot létrehozásakor mappát hoz létre és elindítja a session-t. |
| BotSession | Component | A jelenlegi implementáció központi eleme: egy `claude.exe` subprocess indítása (`-p --input-format stream-json --output-format stream-json --verbose`), a stdin/stdout JSON-sorok kezelése, leállítás. |
| SchedulerService | Component | Tervezett komponens: botonkénti időzítés alapján prompt-okat küldene a megfelelő `BotSession`-nek — a jelenlegi körben még nincs kidolgozva. |
