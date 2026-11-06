---
id: decision-05
title: "ADR-0005 — Bot-bot üzenetcsatorna a hosztba épített MCP szerveren"
type: adr
version: 0.2.1
created: 2026-11-02
updated: 2026-11-05
references:
  - uc-009
  - uc-021
  - decision-04
  - decision-06
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
---

# ADR-0005 — Bot-bot üzenetcsatorna a hosztba épített MCP szerveren

## Metaadatok

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** –
- **Scope:** WinForms host (`ChannelMcpServer`, `BotMessageBus`, `BotSession`,
  `BotSessionManager`, `Form1`), React UI, bot-perzisztencia

## Context

Minden bot egy izolált `claude.exe` session: ma kizárólag a felhasználóval (UC-002) és az
ütemezővel beszél. Ha egy bot olyan részfeladathoz ér, amihez egy másik bot ért, a felhasználónak
kell kézzel átmásolnia az üzenetet — a botok egymásról nem is tudnak.

A két irány aszimmetrikus nehézségű:

- **Subscribe (a hoszt → bot irány) triviális.** A `BotSession.SendPrompt` már ma is képes
  promptot küldeni bármelyik botnak; egy beérkező üzenet pontosan úgy indít kört, mint egy
  felhasználói üzenet.
- **Publish (bot → hoszt irány) a nyitott kérdés.** A bot kimenete egy stream-json folyam, ami
  *leíró*: közli, mit csinált a modell. Nincs benne olyan elem, amit a bot szándékosan, strukturált
  kérésként a hoszthoz intézhetne. A kimenet szöveges szkennelése (pl. egy "ÜZENET:" prefixre)
  törékeny és félreérthető lenne — a modell idézhet, összefoglalhat, elgépelhet.

A `claude.exe`-ből a hoszt felé az **egyetlen tiszta, kétirányú út a tool-hívás**: a modell
szándéka explicit, a paraméterek sémával validáltak, és a hívás vissza is tud adni választ. A
`--permission-prompt-tool stdio` control-protokoll (ADR-0004) ehhez nem használható: az a hoszt
*kérdéseit* hordozza a bot felé, a bot nem kezdeményezhet rajta.

A tervezés közben mért, nem feltételezett tények:

- A CLI a `--mcp-config` kapcsolót **inline JSON-stringként is** elfogadja, nem csak fájlútként —
  így nem kell `.mcp.json`-t írni a bot munkamappájába, és elkerülhető a projekt-hatókörű
  konfiguráció külön jóváhagyási kérdése (amit headless módban senki nem tudna megadni).
- Az `--allowedTools` listában a **`mcp__*` minta nem illeszkedik** az MCP eszközökre: egy
  `mcp__*` engedéllyel futó bot is jóváhagyást kért a `mcp__claudebots__send_message` hívására.
  A ténylegesen illeszkedő alak a szerver-szintű `mcp__<szervernév>` szabály, ami az adott szerver
  minden eszközét fedi.

## Decision

**A publikálást a hoszt folyamatán belül futó, HTTP-transzportos MCP szerver tool-jai
valósítják meg**, a következő kiegészítésekkel:

1. **In-process Kestrel, loopback-only, dinamikus porton.** A szerver a WinForms hoszt
   folyamatában él, nincs külön gyermekfolyamat és életciklus-kezelés. A kötés kizárólag
   `127.0.0.1`, port 0 (az OS ad szabad portot): a csatorna soha nem lóghat ki a gépről, és
   tűzfal-kérdés sem jelenik meg a felhasználónak.
2. **A hívó bot kiléte az URL-útvonal tokenjéből derül ki, nem a tool paraméteréből.** Minden bot
   saját, kitalálhatatlan tokent kap (`/mcp/<token>`), amit csak ő ismer. Így egy bot nem adhatja
   ki magát másnak, és egy idegen helyi folyamat sem tud a csatornára írni. Ismeretlen token esetén
   a válasz 404 — nem áruljuk el, hogy a végpont létezik.
3. **A token a nyilvántartás kulcsa, nem a bot neve.** Így a bot átnevezése magától helyes marad.
4. **Stateless HTTP transzport.** Minden tool-hívás önálló kérés, saját DI-scope-ban — ebben él a
   hívó bot azonosítása, így az megbízhatóan eljut a tool implementációjáig.
5. **Három eszköz:** `list_bots` (kik vannak a csatornán, futnak-e, mivel foglalkoznak — az
   `agent.md` első érdemi sorából), `send_message` (üzenet opcionális címzett-listával és
   opcionális fájlokkal), `recent_messages` (felzárkózás arra, amit a bot kihagyott).
6. **A csatorna eszközei mindig engedélyezettek**, a bot saját `AllowedTools` listájától
   függetlenül. A bot-bot üzenetváltás szándékosan nem jóváhagyás-köteles: különben minden
   delegálás megállna, amíg nincs valaki a gép előtt. A szabály **nem** íródik vissza a mentett
   `AllowedTools`-ba — az a felhasználó beállítása, ez pedig a rendszer saját, belső képessége.
   *(Az engedély eredetileg szerver-szintű `mcp__claudebots` szabállyal ment ki. Amióta ugyanezen
   a szerveren jóváhagyás-köteles eszközök is élnek, eszközönkénti szabály megy helyette —
   ADR-0006.)*
7. **A csatorna nincs particionálva.** Egyetlen közös busz van; a `to` lista csak azt szűkíti,
   kinek kézbesítünk, nem külön csatornákat hoz létre. Címzés nélkül minden másik bot megkapja.
8. **Aszinkron üzenetváltás.** A `send_message` azonnal visszatér azzal, kihez jutott el az üzenet
   és kihez nem (és miért) — a válasz később, önálló csatorna-üzenetként érkezik. Semmi nem
   blokkol, így nincs két bot közti holtpont-lehetőség.
9. **Bot-onkénti kapcsoló (`ChannelEnabled`), ami futásidőben hat.** A tiltást a busz
   érvényesíti, nem az indítási paraméterek — így a kapcsoló átbillentése **nem indítja újra** a
   botot, és nem dobja el a beszélgetés kontextusát.
10. **Kettős visszaélés-korlát:** válasz-lánc mélysége legfeljebb 3 (a kézbesített üzenetből
    indult kör hopja öröklődik és nő), és botonként legfeljebb 10 üzenet / 5 perc. Mindkét esetben
    a küldő elutasító, magyarázó választ kap — a lánc megáll, nem némán.
11. **A csatorna-forgalom saját sortípust kap a csevegésben** (`LogKind.Channel`), és **nem vált
    ki olvasatlan-jelzést**: egy bot-bot üzenet nem a felhasználónak szól, a neki szánt válasz úgyis
    rendes bot-válaszként érkezik.
12. **A csatorna hiánya nem végzetes.** Ha a szerver nem indul el, a botok egyszerűen
    csatorna-eszközök nélkül futnak tovább, minden más funkció változatlan.
13. **A fájlátadás másolással történik, nem megosztott eléréssel.** A botok munkamappái el vannak
    különítve; a hoszt a küldő mappájából a címzett mappájába másolja a fájlt, és a kézbesített
    promptban `@` hivatkozást ad rá — ugyanaz a mechanizmus, amivel a felhasználó csatol fájlt a
    csevegésben. A másolat a címzettnél **küldőnkénti mappába** kerül (`_bejovo/<küldő>/`), nem a
    munkamappa gyökerébe: ott egy azonos nevű fájl némán felülírná a címzett saját munkáját. A
    küldő csak a saját mappáján belülről küldhet (a feloldott útvonalat ellenőrizzük), egy
    üzenethez legfeljebb 5 fájl mehet, egyenként legfeljebb 10 MB — a csatorna munkaanyagok
    átadására való, nem fájlmásolásra. Ezek a korlátok, akárcsak a hibás fájlnév, a küldőnek szóló
    magyarázó szöveggel járnak, nem néma elhagyással.

## Alternatives considered

**A) Híd-folyamat MCP szerverként, stdio transzporton (bot-onként egy)**
- **For:** Nem kell HTTP-réteg a hosztba; az stdio a legegyszerűbb MCP transzport.
- **Against:** Bot-onként egy extra gyermekfolyamat, aminek az életciklusát kezelni kell (és ami
  az app összeomlásakor árván maradhat — ezt a hibát a bot-terminálokkal már egyszer
  elszenvedtük). A
  híd-folyamatnak ráadásul külön IPC-csatorna kellene *vissza* a hoszthoz, vagyis a problémát csak
  eltolja egy réteggel.
- **Why not chosen:** Több mozgó alkatrész ugyanazért a funkcióért, miközben az in-process szerver
  a buszt közvetlenül, memóriából éri el.

**B) Fájl-alapú outbox a bot munkamappájában**
- **For:** Semmilyen új protokoll vagy hálózati réteg; a bot a már engedélyezett `Write`
  eszközzel üzenne.
- **Against:** A fájlba írás nem szándéknyilvánítás: a modell bármikor írhat hasonló fájlt más
  célból. Kellene egy figyelő, ütemezett pollozás, fájlzárolás-kezelés, és nincs visszacsatolás —
  a bot nem tudná meg, kihez jutott el az üzenet. A küldő kiléte is csak a mappából következne.
- **Why not chosen:** Nincs benne explicit szándék és nincs válaszút; mindkettő a feature lényege.

**C) A bot kimenetének szöveges szkennelése egy megállapodott mintára**
- **For:** Nulla új infrastruktúra.
- **Against:** Törékeny és félreérthető: a modell idézheti a mintát, összefoglalhatja,
  elgépelheti; a strukturált paraméterek (címzett-lista) szövegből parsolása pedig hibaforrás.
- **Why not chosen:** Pontosan az a megoldás, ami miatt a tool-hívás létezik.

**D) `HttpListener` (http.sys) a Kestrel helyett**
- **For:** Nincs szükség az ASP.NET Core shared frameworkre.
- **Against:** Az http.sys URL-ACL foglalást igényelhet (emelt jogosultsággal), és a hivatalos
  MCP szerver-könyvtár ASP.NET Core-ra épül — a transzportot kézzel kellene implementálni.
- **Why not chosen:** A Kestrel közvetlenül socketre köt, loopbacken rendszergazdai beavatkozás
  nélkül.

## Consequences

**Positive:** Egy bot a saját körén belül, a felhasználó közreműködése nélkül vonhat be egy másik
botot, és a válaszát felhasználhatja. A forgalom mindkét fél csevegésében látszik, így a
felhasználó érti, mitől "mozdult meg" magától egy bot. A `list_bots` leírásai (`agent.md`) adják a
szakterület-térképet, így a delegálás nem vaktában történik.

**Negative / accepted cost:**
- **Tokenköltség.** Egy delegálás két-három extra kört jelent két boton. Ezt a hop- és a
  darabszám-korlát fogja be, de a költség valós.
- **A lánc-mélység mérése tévedhet.** A hop a bot legrégebbi nyitott köréhez kötődik (ugyanaz a
  heurisztika, mint a jóváhagyás-hozzárendelésnél, ADR-0004) — átfedő körök esetén egy üzenet
  rossz mélységet örökölhet. A tévedés ára legfeljebb egy korábban/később életbe lépő korlát,
  nem adat- vagy biztonsági hiba.
- **A csatorna-előzmény memóriában él** (az utolsó 200 üzenet), és az app újraindításakor
  elveszik — ahogy a beszélgetés-előzmény is.
- **Az átküldött fájlok sokszorozódnak a lemezen,** és a címzett mappájában maradnak az üzenet
  feldolgozása után is: a `_bejovo/` mappa takarítása a felhasználóra marad. Cserébe a címzett
  később is vissza tud nyúlni a kapott anyaghoz, és a másolat nem változik meg a háta mögött, ha
  a küldő közben átírja az eredetit.
- **Egy bot megszólíthat olyan botot is, amire a felhasználó nem számít.** A védelem a
  bot-onkénti kikapcsolhatóság és a csevegésben látható forgalom; hozzáférési mátrix (ki kinek
  üzenhet) szándékosan nem készült — az a jelenlegi, néhány botos használathoz aránytalan.
- **Új függőség:** `ModelContextProtocol.AspNetCore` és az ASP.NET Core shared framework. Egy
  WinForms alkalmazás így webszerver-képességet kap, ami a telepítési előfeltételeket szigorítja.

**Neutral, but worth knowing:** A `--strict-mcp-config` szándékosan nem kerül a parancssorba: a
felhasználó globálisan konfigurált MCP szerverei (pl. azure-devops) maradjanak elérhetők a botok
számára.

## Action items

- [ ] A CLI frissítése után ellenőrizni, hogy az inline `--mcp-config` és a szerver-szintű
      `mcp__<szervernév>` engedélyszabály változatlanul működik-e.

## References

`ClaudeBotApp/ChannelMcpServer.cs`, `ClaudeBotApp/BotMessageBus.cs`,
`ClaudeBotApp/ChannelMessage.cs`, `ClaudeBotApp/BotSession.cs`,
`ClaudeBotApp/BotSessionManager.cs`, `ClaudeBotApp/Form1.cs`.
