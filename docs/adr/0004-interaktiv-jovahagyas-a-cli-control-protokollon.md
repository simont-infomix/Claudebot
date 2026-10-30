---
id: decision-04
title: "ADR-0004 — Interaktív tool-jóváhagyás a claude.exe stdio control-protokollján"
type: adr
version: 0.1.0
created: 2026-10-30
updated: 2026-10-30
references:
  - uc-009
  - uc-018
  - decision-01
  - architecture-c3-claude-code-cli-session
---

# ADR-0004 — Interaktív tool-jóváhagyás a claude.exe stdio control-protokollján

## Metaadatok

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** –
- **Scope:** WinForms host (`BotSession`, `BotTaskScheduler`), React UI, bot-perzisztencia

## Context

A ClaudeBot headless (`-p`) módban futtatja a `claude.exe`-t. Ebben a módban a CLI-nek
nincs terminálja, ahol jóváhagyást kérhetne, a host pedig sosem épített ki ilyen csatornát:
minden olyan eszközhívás, amit az `--allowedTools` lista vagy a Permission mode nem engedett
automatikusan, **némán elutasításra került**. A felhasználó ebből annyit látott, hogy a bot
"kérdez valamit", de válaszolni nem tudott rá (BUG-004).

A hiányzó csatorna a tervezés kezdetén **nem volt dokumentált**: sem a CLI `--help`-je, sem a
nyilvános dokumentáció nem írja le a stream-json kétirányú control-protokollját. A döntés
ezért egy felderítési lépésre épül: a telepített `claude.exe` (2.1.221) binárisának
string-elemzése, majd a feltételezések **éles igazolása** egy eldobható harness-szel.

A felderítés eredménye (mért, nem feltételezett):

- A `--permission-prompt-tool stdio` kapcsoló kapcsolja be a protokollt. A CLI-ben a
  handler-választás: `if (e === "stdio") return t.createCanUseTool(n);`, ahol `e` a kapcsoló
  értéke. Az Agent SDK ugyanezt teszi, amikor `canUseTool` callbacket kap.
- **Nyitott stdin feltétel:** lezárt stdin mellett (`echo | claude.exe`) a CLI nem küld kérést,
  hanem némán elutasít. A `BotSession` a stdin-t végig nyitva tartja, tehát ez adott.
- A kérés alakja: `{"type":"control_request","request_id":…,"request":{"subtype":"can_use_tool",
  "tool_name":…,"input":{…},"permission_suggestions":[…],"tool_use_id":…,"decision_reason":…}}`.
- A válasz alakja: `{"type":"control_response","response":{"subtype":"success","request_id":…,
  "response":{"behavior":"allow"|"deny",…}}}`.
- **Elutasításkor a kör `is_error: false`-szal zárul** — az egyetlen jelzés a `result` sor
  `permission_denials` tömbje.
- A válaszba csomagolt `updatedPermissions` szabály a **futó folyamatra**, újraindítás nélkül
  érvényesül (igazolva: engedélyezés után egy másik parancs már nem váltott ki kérést).

## Decision

**A jóváhagyási csatornát a `--permission-prompt-tool stdio` control-protokollra építjük**, a
`BotSession` stdin/stdout csatornáján, a következő kiegészítésekkel:

1. **A függő kérések nyilvántartása a `BotSession`-ben él.** A `request_id` kizárólag az őt
   kiállító `claude.exe` példányon belül értelmes, és pontosan annak élettartamáig — ugyanez
   az objektum birtokolja a folyamatot. A `WebViewBridge` állapotmentes fordítóréteg marad, a
   React oldal pedig derivált nézet.
2. **Minden stdin-írás egyetlen, zárolt metóduson megy át.** A csatornára ezentúl három
   szálról is írhatunk (UI-szál, lejárati időzítő, kimenet-olvasó szál), a `StreamWriter`
   viszont nem szálbiztos: lock nélkül két sor összekeveredhetne, amitől a kommunikáció
   némán elromlana.
3. **A kör sikerességét nem az `is_error` dönti el.** A `TurnCompleted` esemény `TurnResult`
   rekordot hordoz `FailureReason` mezővel, amit az elutasított kérés tölt ki.
4. **A kérést a legrégebbi nyitott körhöz rendeljük.** A `control_request` nem hordoz
   prompt-azonosítót, csak `tool_use_id`-t, ezért a `BotSession` a még le nem zárt körök
   listájának fejéhez köti. Ebből derül ki, hogy ütemezett futásról van-e szó.
5. **Kétszintű határidő:** ütemezett körnél 5 perc, kézi üzenetnél 30 perc, utána automatikus
   elutasítás.
6. **A "Mindig engedélyezd" kettős hatású:** session hatókörű, eszköz-szintű szabály a futó
   folyamatnak, **és** az eszköz felvétele a bot mentett `AllowedTools` listájába — de
   **bot-újraindítás nélkül**, az `ApplySettings` újraindítási logikáját szándékosan megkerülve.
7. **Bot-onkénti kapcsoló** (`InteractiveApproval`, alapértelmezetten bekapcsolva) marad
   vészkapcsolónak.

## Alternatives considered

**A) Saját MCP-szerver `--permission-prompt-tool mcp__<szerver>__<tool>` értékkel**
- **For:** Ez a kapcsoló dokumentált használati módja; a protokoll (MCP) nyilvános és stabil.
- **Against:** A hostnak egy teljes MCP-szervert kellene futtatnia és életciklusát kezelnie
  bot-onként; a CLI a szerver csatlakozására vár az első kör előtt (MCP_TIMEOUT); jelentősen
  több mozgó alkatrész ugyanazért a funkcióért.
- **Why not chosen:** Aránytalan komplexitás egy olyan csatornáért, amit a `stdio` érték egyetlen
  kapcsolóval, külön folyamat nélkül megad.

**B) Maradás az `--allowedTools` előzetes engedélyezésnél (a mai állapot)**
- **For:** Nulla kockázat, nincs függés nem dokumentált viselkedéstől.
- **Against:** Nem oldja meg a problémát: a felhasználónak előre ki kellene találnia, mire lesz
  szüksége a botnak, és a hiányzó engedély továbbra is néma elutasítás maradna.
- **Why not chosen:** Épp ez a BUG-004 tárgya.

**C) Modális dialógus a kérés megjelenítésére**
- **For:** Lehetetlen átsiklani fölötte.
- **Against:** Blokkolja a felületet, miközben több bot fut párhuzamosan; két egyidejű kérés
  sorba állna; a bot-váltás ellehetetlenülne a döntésig.
- **Why not chosen:** Ellentétes az app alapvető több-bot működésmódjával.

## Consequences

**Positive:** A bot eszközhívásai nem vesznek el némán; elutasításkor a bot értesül és
szövegesen reagál. A tartós engedély a beszélgetés kontextusának elvesztése nélkül adható meg.
A `permission_denials` megjelenítése kikapcsolt jóváhagyás mellett is láthatóvá teszi az
elutasításokat.

**Negative / accepted cost:**
- **Nem dokumentált protokollra építünk** — egy jövőbeli CLI-verzió megváltoztathatja az
  üzenetek alakját vagy a kapcsoló jelentését. A feldolgozás ezért végig defenzív (hiányzó
  mezőkre nem dől el), és a `claudebot-stream.log` minden nyers sort rögzít, hogy egy ilyen
  változás diagnosztizálható legyen.
- **A kör-hozzárendelés tévedhet,** ha egy kézi üzenet és egy ütemezett futás köre átfed. A
  tévedés ára egy rossz címke a kártyán, illetve rossz feladathoz könyvelt sikertelenség —
  nem adat- vagy biztonsági hiba. Pontosabb megoldás a jelenlegi protokoll-mezőkből nem
  vezethető le.
- **Viselkedésváltozás minden meglévő botnál:** ami eddig azonnal elutasításra került, most
  megáll és vár. Az ütemezett futásoknál ezt az 5 perces plafon fogja be.
- A futásidejű szabályt a CLI elvetheti (a binárisban van ilyen figyelmeztetés), ezért a
  "Mindig engedélyezd" sikerét nem jelentjük vissza sikerként — a mentett lista a biztosíték.

**Neutral, but worth knowing:** A `permission_suggestions` mezőt szándékosan **nem** küldjük
vissza változatlanul: a CLI javaslata `localSettings` célponttal a lemezre írna, és csak a
konkrét paraméterre (pl. egyetlen parancsra) adna engedélyt — a felhasználó viszont az egész
eszközt engedélyezte.

## Action items

- [ ] A CLI frissítése után ellenőrizni, hogy a kérés/válasz alakja változatlan-e.

## References

`ClaudeBotApp/BotSession.cs`, `ClaudeBotApp/PermissionRequest.cs`,
`ClaudeBotApp/BotTaskScheduler.cs`, `ClaudeBotApp/react-ui/src/components/PermissionCard.tsx`,
`docs/bugs/bug-004-nincs-interaktiv-jovahagyas-csatorna.md`.
