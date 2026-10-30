---
id: bug-004
title: "BUG-004 — Nincs mód interaktív tool-jóváhagyásra; a bot nem értesül az elutasításról"
type: bug
version: 0.2.0
created: 2026-10-29
updated: 2026-10-30
references:
  - uc-009
  - uc-018
  - decision-04
  - architecture-c3-claude-code-cli-session
---

> **Állapot: javítva (2026-10-30).** A megoldást lásd a dokumentum végén.

## Összefoglalás

A felhasználó nem tud jóváhagyást adni egy bot tool-használati kéréséhez, és erről a bot
sem értesül — így a kérés válasz nélkül marad, a bot pedig (a felhasználó számára nem
nyilvánvaló módon) újra felteszi, vagy a kör a kért művelet végrehajtása nélkül zárul le.

Ez nem egyedi hiba, hanem egy **architekturális hiányosság** konkrét megnyilvánulása: a
`claude.exe` headless (`-p`) módban indul, és — ahogy ezt a UC-009 már rögzíti — "nincs
felugró jóváhagyás". Eddig ezt kizárólag a `--allowedTools` előzetes engedélyezéssel (UC-009)
kezeltük. A Settings lap "Beállítások" fülén viszont olyan Permission mode-ok is
kiválaszthatók (pl. `manual`), amelyek éppen egy **futásidejű, interaktív** jóváhagyási
kört feltételeznének a CLI és a host között — ezt a ClaudeBotApp sosem implementálta:
nincs se a bejövő kérés felismerése/megjelenítése, se kimenő válasz (jóváhagyás/elutasítás)
küldésének mechanizmusa.

## Reprodukálás

1. Állíts be egy botnak olyan Permission mode-ot a Settings lapon, ami interaktív
   jóváhagyást feltételez (pl. `manual`).
2. Adj a botnak olyan feladatot, ami egy előzetesen nem engedélyezett tool használatát
   igényelné.
3. **Eredmény:** a felhasználó felületen semmilyen jóváhagyó/elutasító lehetőséget nem
   kap; a bot válasza vagy elakad, vagy a kért művelet nélkül fejeződik be — a UI nem
   jelzi, hogy valójában egy válaszra váró kérés veszett el.

## Valószínű kiváltó ok

- `BotSession.Start()` a `--permission-mode` kapcsolót a Settings lapon kiválasztott,
  **statikus**, session-szintű módra állítja — ez önmagában nem probléma `acceptEdits`,
  `bypassPermissions` vagy `dontAsk` esetén, mert ezek nem várnak futásidejű választ.
  `manual` (és feltehetően `plan`) viszont a `claude.exe` oldalán egy, az egyes
  tool-hívásokra vonatkozó kérés/válasz kört feltételez.
- `BotSession.ExtractLogEntries`/`OnOutputDataReceived` csak az `assistant` és `result`
  típusú stream-json sorokat ismeri fel (ld. `TryRaiseTurnCompleted`) — egy esetleges
  jóváhagyás-kérő esemény típusát a kód nem kezeli, így az vagy némán eldobódik, vagy
  (ha a JSON-parse egyáltalán elbukik rajta) `LogKind.Info`-ként, feldolgozatlanul
  jelenik meg.
- `BotSession.SendPrompt` az egyetlen kimenő üzenet-útvonal a `claude.exe` felé — nincs
  implementálva semmilyen "jóváhagyás"/"elutasítás" típusú válaszüzenet küldése.
- Emiatt a kiválasztható Permission mode-ok listája (`SettingsView.tsx` —
  `PERMISSION_MODE_OPTIONS`) jelenleg olyan értékeket is felkínál, amik ezzel az
  architektúrával garantáltan nem működnek megfelelően, anélkül hogy ezt a felület
  jelezné.

## Javaslat

Két, egymást nem kizáró irány (eldöntendő, melyik szükséges):

1. **Rövid távon:** a Permission mode választékból vegyük ki (vagy jelöljük külön
   figyelmeztetéssel) azokat a módokat, amik interaktív jóváhagyást igényelnének, amíg
   a 2. pont nincs megvalósítva — hogy a felhasználó ne tudjon véletlenül egy
   működésképtelen módot beállítani.
2. **Hosszú távon:** fel kell deríteni a `claude.exe` stream-json protokolljának
   tényleges jóváhagyás-kérő/válasz üzenettípusait (ehhez egy éles reprodukálás és a
   `claudebot-stream.log` tartalmának vizsgálata szükséges — jelenleg egyetlen meglévő
   naplóban sem található ilyen esemény), majd megépíteni mind a bejövő kérés UI-beli
   megjelenítését, mind a kimenő válasz küldésének mechanizmusát.

## Megoldás

A 2. javaslat valósult meg; a rövid távú (opciók kivétele a felületről) ezzel tárgytalanná vált.

A protokoll felderítése a telepített `claude.exe` binárisának elemzésével, majd éles méréssel
történt. A kulcs a `--permission-prompt-tool stdio` kapcsoló, ami bekapcsolja a kétirányú
control-protokollt: a CLI a stdout-ra küld egy `can_use_tool` kérést, és a stdin-en várja a
döntést. Feltétele, hogy a stdin végig nyitva maradjon — lezárt stdin mellett a CLI némán
elutasít. A részletes sémát és a döntés indoklását az ADR-0004 rögzíti, a felhasználói
folyamatot az UC-018.

A javítás során két, a jelentésben még nem ismert hiba is felszínre került:

- **A megválaszolatlan jóváhagyás miatt félbemaradt ütemezett futás sikeresnek látszott.** A
  `claude.exe` az elutasított eszközhívás után is `is_error: false`-szal zárja a kört; az
  egyetlen jelzés a `result` sor `permission_denials` tömbje, amit a kód nem nézett. A
  `BotTaskScheduler` ezért minden ilyen futást `Success`-ként könyvelt volna el.
- **Az elutasított tool-hívás a felületen némán maradt** akkor is, ha interaktív jóváhagyásra
  nincs mód: a `permission_denials` tartalma mostantól a csevegésben is megjelenik, így a
  kapcsoló kikapcsolt állapotában is látszik, mi nem futott le és miért.
