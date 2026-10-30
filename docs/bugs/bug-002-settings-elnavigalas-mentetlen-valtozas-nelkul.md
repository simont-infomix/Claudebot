---
id: bug-002
title: "BUG-002 — Settings lapról elnavigálva nem jelez mentetlen módosítást"
type: bug
version: 0.1.0
created: 2026-10-29
updated: 2026-10-29
references:
  - architecture-c3-react-ui
---

## Összefoglalás

A Settings lap mentetlen-módosítás megerősítése (a `×` bezárás gombra kattintva, ld. a
korábbi, "ha megváltoztatok egy beállítást, de mentés nélkül be akarom zárni..." igény
alapján megvalósított logika) **csak akkor** ugrik be, ha a felhasználó a Settings lap
saját `×` gombjával zárja be a panelt. Ha ehelyett a sidebarban egy **másik botra
kattint**, a Settings lap mentetlen módosítással együtt, figyelmeztetés nélkül bezáródik
— a módosítás elvész.

## Reprodukálás

1. Nyisd meg egy bot Settings lapját (bármelyik fülön).
2. Módosíts egy mezőt (pl. Model), de **ne** mentsd el.
3. Kattints a sidebarban egy másik bot avatarjára.
4. **Eredmény:** a Settings lap bezáródik, a módosítás elvész, semmilyen megerősítő
   kérdés nem jelenik meg. Elvárt lenne: ugyanaz a "mentetlen módosítások vannak, biztos
   bezárod?" jellegű megerősítés, mint a `×` gombnál vagy az app-bezárásnál.

## Valószínű kiváltó ok

`ClaudeBotApp/react-ui/src/App.tsx` — `handleSelectBot(botId)`:

```tsx
function handleSelectBot(botId: string) {
  setSelectedBotId(botId);
  setLogs([]);
  setSettingsOpen(false);   // <-- feltétel nélkül zár, a settingsDirty állapotot nem nézi
  ...
}
```

A mentetlen-módosítás megerősítő logika (`isDirty`, `showCloseConfirm`,
`requestClose()`) kizárólag a `SettingsView` komponensen belül létezik, és csak a
komponens saját `×` gombjához (`settings-view__close`) van bekötve. Az `App.tsx` a
`settingsDirty` állapotot ismeri (a `onDirtyChange` callback-en keresztül kapja meg —
ld. a tálcára-rejtés/app-bezárás megerősítéshez), de `handleSelectBot` ezt nem
ellenőrzi, mielőtt közvetlenül `setSettingsOpen(false)`-t hívna.

## Javaslat

A dirty-ellenőrzést fel kell emelni (vagy duplikálni) `App.tsx` szintjére: mielőtt
`handleSelectBot` ténylegesen váltana botot és zárná a Settings lapot, ellenőriznie
kellene a `settingsDirty` állapotot, és ha igaz, meg kell jelenítenie egy megerősítő
dialógust (újrafelhasználva a meglévő `ConfirmDialog` komponenst, hasonlóan az
app-bezárási folyamathoz) — csak megerősítés után engedve végbemenni a bot-váltást.
