---
id: decision-06
title: "ADR-0006 — A bot a saját ütemezett feladatait a hoszt MCP szerverén kezeli, tool-szintű engedéllyel"
type: adr
version: 0.1.0
created: 2026-11-05
updated: 2026-11-05
references:
  - uc-010
  - uc-018
  - uc-022
  - decision-01
  - decision-04
  - decision-05
---

# ADR-0006 — A bot a saját ütemezett feladatait a hoszt MCP szerverén kezeli, tool-szintű engedéllyel

## Metaadatok

- **Status:** Accepted
- **Date:** 2026-11-05
- **Deciders:** –
- **Scope:** WinForms host (`BotTaskTools`, `ChannelMcpServer`, `BotSessionManager`,
  `BotSession`), bot-perzisztencia

## Context

Az ütemezett feladatokat eddig kizárólag a felhasználó szerkesztette a Feladatok fülön (UC-010).
Maga a bot nem tudta, milyen rendszeres dolga van: a feladat futásakor csak a promptot kapta meg,
kontextus nélkül. A "mostantól minden reggel nézd meg a PR-eket" típusú kérés pedig kétlépcsős
volt — a felhasználó elmondta a botnak, majd kézzel kitöltötte ugyanazt az ütemezőben.

A hoszt MCP szervere (ADR-0005) már megoldotta a nehezét: a bot felől érkező hívás token alapján
azonosítja a hívót, és ez az azonosítás nem meghamisítható. Ugyanez kell a feladatokhoz is —
a bot csak a SAJÁT feladatait láthatja.

A nyitott kérdés az engedélyezés volt. A csatorna eszközei ma szerver-szintű szabállyal
(`mcp__claudebots`) mindig engedélyezettek, ami az adott szerver **minden** eszközét fedi. Ha a
feladat-írás ugyanerre a szerverre kerül, automatikusan jóváhagyás nélkülivé válna — a bot a
felhasználó tudta nélkül írhatná át a saját ütemezéseit.

A tervezés közben mért, nem feltételezett tény:

- Az `--allowedTools` listában a **tool-szintű `mcp__<szerver>__<tool>` szabály illeszkedik**, és
  pontosan egy eszközre hat. Egy kétszerszámos próba-MCP-szerverrel ellenőrizve: a felsorolt
  eszköz `dontAsk` módban is lefutott, a fel nem sorolt ugyanott elutasításra került. (Ez nem
  mond ellent az ADR-0005 megfigyelésének: ott a `mcp__*` **wildcard** nem illeszkedett.)

## Decision

**A feladat-eszközök a meglévő hoszt-MCP-szerverre kerülnek, és a jogosultságot nem a szerverek
szétválasztása, hanem tool-szintű engedélyszabály adja.**

1. **Három eszköz, saját hatókörrel:** `list_tasks` (a hívó bot feladatai, ütemezésük, következő
   és legutóbbi futásuk), `add_task` (új feladat), `update_task` (név, prompt, ütemezés,
   szüneteltetés). Mindegyik kizárólag a hívó bot feladataira hat — a hívó kiléte az URL
   tokenjéből derül ki, nem paraméterből.
2. **Olvasás szabad, írás jóváhagyás-köteles.** A bot indítási parancssorába a hoszt eszközei
   közül csak a jóváhagyás nélkül hívhatók kerülnek fel, egyenként (`mcp__claudebots__list_tasks`
   és a csatorna három eszköze). Az `add_task`/`update_task` kimarad, így a futásidejű jóváhagyási
   csatornán (ADR-0004, UC-018) megy: a felhasználó kártyát kap, és dönt. A szerver-szintű
   `mcp__<szerver>` szabály ezért nem használható többé — helyette tool-szintű felsorolás megy ki.
3. **A tool-nevek egyetlen helyen, konstansként élnek** (`HostToolNames`), mert két helyen kell
   pontosan egyezniük: az eszköz attribútumában és az engedélylistában. Egy elgépelés ott nem
   fordítási hibaként, hanem némán soha-nem-engedélyezett eszközként jelentkezne.
4. **Törlés nincs.** A felhasználó által felvett feladat nem tűnhet el a bot döntéséből; a
   legerősebb művelet a szüneteltetés, ami a felületen látszik és egy kattintással visszavonható.
5. **Az ütemezést a menetrend-számító validálja, nem külön szabályhalmaz.** A tool a mezőkből
   összerak egy ütemezést, majd megkérdezi a `TaskScheduleCalculator`-t (ADR-0001): ha az nem ad
   érvényes következő futást, a feladat nem jön létre. Így nem keletkezhet olyan ütemezés, amit a
   scheduler később nem tudna értelmezni.
6. **A feladatlista cserélődik, nem helyben módosul.** A bot a saját MCP-hívásának szálán ír, a
   scheduler és a felület a UI-szálon olvas. A csere (copy-on-write, közös záron belül) atomi: az
   olvasó vagy a régi, vagy az új listát látja, félkész állapotot soha.
7. **Minden változás nyomot hagy a csevegésben.** A tartós engedély megadása után a jóváhagyási
   kártya elmarad, ezért a hoszt maga ír egy sort a bot folyamába arról, mi változott — enélkül a
   bot némán alakítaná át a saját ütemezéseit.

## Alternatives considered

**A) Külön MCP szerver az írás-eszközöknek**
- **For:** A jogosultság a szerver határán dőlne el, a meglévő szerver-szintű engedélyszabály
  változatlan maradhatna.
- **Against:** Két MCP szerver ugyanabban a hoszt-folyamatban (külön tool-készlettel, külön
  végponttal és konfigurációval) lényegesen több mozgó alkatrész — ráadásul a `list_tasks`
  olvasásnak és az írásnak ugyanaz a token-azonosítása és ugyanaz a háttér-API kell.
- **Why not chosen:** A tool-szintű engedélyszabály ugyanezt a határt meghúzza egyetlen
  szerveren belül, mérhetően működik, és nem duplikál infrastruktúrát.

**B) A feladatkezelés a bot-bot csatorna eszközeibe olvasztva (minden jóváhagyás nélkül)**
- **For:** A legkevesebb kód; a bot azonnal, akadálytalanul kezelhetné a feladatait.
- **Against:** A bot a felhasználó megkérdezése nélkül írhatná át a saját ütemezéseit. Egy
  félreértett kérés így tartós, ismétlődő háttérmunkát hozhatna létre, valódi tokenköltséggel.
- **Why not chosen:** Az ütemezés a felhasználó eszköze a bot felett; ezt a bot nem veheti el
  némán.

**C) Csak olvasás (`list_tasks`), írás nélkül**
- **For:** Semmilyen új kockázat; a bot kontextusba kerül, de nem avatkozik be.
- **Against:** A "vedd fel magadnak" típusú kérés továbbra is kézi kitöltést igényelne a
  Feladatok fülön, pedig a bot a beszélgetésből pontosan tudja, mit kell ütemezni.
- **Why not chosen:** A jóváhagyási csatorna (UC-018) pont erre való — a kockázat kezelhető
  anélkül, hogy a képességet elvennénk.

## Consequences

**Positive:** A bot kontextusban van a saját rendszeres munkájával, és a felhasználó egyetlen
mondatából létre tud jönni egy helyesen kitöltött ütemezés. A jóváhagyási kártya miatt a
felhasználó pontosan azt látja, mit akar felvenni a bot, mielőtt az megtörténne.

**Negative / accepted cost:**
- **A csatorna eszközeinek engedélyezése finomabb, de törékenyebb lett.** Négy tool-szintű
  szabály megy ki egy szerver-szintű helyett; egy új eszköz felvételekor az `AlwaysAllowed`
  listát is karban kell tartani, különben az új eszköz némán jóváhagyás-kötelessé válik. A
  `HostToolNames` konstansok ezt csak részben védik ki.
- **Kikapcsolt interaktív jóváhagyás mellett az írás használhatatlan.** Ilyenkor a bot minden
  `add_task`/`update_task` hívása elutasításra kerül — szándékos, de a bot szempontjából "néma
  fal", amit csak a hibaszövegből ért meg.
- **Ütemezett (éjszakai) körben nincs, aki jóváhagyjon.** A felügyelet nélküli futás így
  olvasásra korlátozódik; az írás a jóváhagyási határidő lejártával elutasításra kerül.
- **A bot által felvett feladat a felhasználó listájában keveredik a sajátjaival.** A felületen
  ma nem látszik, melyiket vette fel a bot — csak a csevegés sora árulkodik róla.

## Action items

- [ ] Ha a CLI engedélyillesztése változik, újra ellenőrizni a tool-szintű szabályt — ezen
      múlik, hogy az írás-eszközök jóváhagyás-kötelesek maradnak-e.

## References

`ClaudeBotApp/BotTaskTools.cs`, `ClaudeBotApp/ChannelMcpServer.cs`,
`ClaudeBotApp/BotSessionManager.cs`, `ClaudeBotApp/BotSession.cs`,
`ClaudeBotApp/ScheduledTask.cs`, `ClaudeBotApp/TaskScheduleCalculator.cs`.
