# Todo MCP

MCP szerver + webes miniapp azoknak a kérdéseknek, amik coding agenttel (Claude Code) végzett munka
közben merülnek fel, de **emberi döntést igényelnek**. Az agent az `add_todo` toollal félreteszi őket,
és folytatja a munkát; te a böngészőben nézed át, váltasz státuszt és bejegyzésekkel követed a haladást.

Ez nem az agent teendőlistája: **magától semmi nem megy vissza** az agenthez. Ha egy döntést meg kell
valósítani, azt te adod be neki a szokásos módon — ilyenkor elég a sorszámra hivatkozni, a
`get_ticket(id)` toollal az agent kiolvassa a tétel teljes tartalmát a bejegyzéseiddel együtt.
A cetlin lévő *Prompt másolása* gombbal a kész mondat egyből a vágólapra kerül. Az agent az
`update_ticket`-tel vissza tud jegyezni, mit csinált — **lezárni viszont nem tud**, az a te dolgod.

## Felépítés

Egy Node process szolgál ki mindent a `127.0.0.1:4321`-en:

| Útvonal | Mi |
|---|---|
| `/mcp` | streamable HTTP MCP végpont (stateless) |
| `/api/*` | JSON API a web UI-nak |
| `/` | a beépített React SPA |

Az adatok egyetlen globális SQLite fájlban vannak (`~/.todo-mcp/todos.db`), tehát minden projekt
todója egy helyen látszik; a repo a szűrő. Egy todo **több repóhoz is tartozhat** (ezt a webes
felületen állítod), az agent viszont mindig pontosan egy repóval veszi fel a sajátjait.

## Telepítés

```bash
npm install
npm run build
npm start          # → todo-mcp listening on http://127.0.0.1:4321
```

MCP szerver regisztrálása Claude Code-ban (elég egyszer, minden projektre érvényes):

```bash
claude mcp add --transport http todo-mcp http://127.0.0.1:4321/mcp --scope user
```

Ezután új session-ben a `/mcp` listázza a `todo-mcp`-t, és az agent használhatja az `add_todo`-t.

**A szolgáltatás nem indul automatikusan.** Ha nem fut, az MCP hívás hibát ad (az agent jelzi).
Ha csak a szervert akarod automatikusan indítani (fejnélküli, PWA-s használatra), tegyél egy
`.cmd`-t a `shell:startup` mappába, ami `npm start`-ot futtat ebben a könyvtárban. Ha inkább egy
natív, tálcaikonos alkalmazást szeretnél, ami Windows-bejelentkezéskor magától felébred — lásd a
*Vastag kliens (Electron)* szakaszt lentebb.

## Konfiguráció

| Env var | Default | Mi |
|---|---|---|
| `TODO_MCP_PORT` | `4321` | HTTP port |
| `TODO_MCP_DB` | `~/.todo-mcp/todos.db` | SQLite fájl útvonala |

A szerver mindig csak `127.0.0.1`-re bindol, és nincs autentikáció: egygépes, egyfelhasználós eszköz.
A `/mcp` végpont a `Host` fejlécet ellenőrzi (DNS rebinding ellen).

## MCP toolok

**`add_todo(repo, title, description?)`** — felvesz egy tételt `open` státusszal.
`repo` a projektmappa rövid neve (pl. `todo-mcp`), és **pontosan egy** adható meg; ha a tétel több
projektet érint, te teheted hozzá a többit a webes felületen. `title` egy soros (kérdés, ha döntés
kell), `description` opcionális kontextus, markdownként renderelve.

**`list_todos(repo?, status?)`** — a már felvett tételek (default: `open` + `in_progress`).
Célja, hogy az agent lássa, mi van bent, és ne írja be kétszer ugyanazt. Bejegyzéseket nem ad vissza,
csak a darabszámukat — abból látszik, melyik tételre érdemes `get_ticket`-et hívni.
A több repóhoz rendelt tétel mindegyik repo szűrésében megjelenik.

**`search_todos(query, repo?, status?)`** — keresés cím és leírás szövegében. Ugyanaz a kimenet,
mint a `list_todos`-é. Egy képernyőnyi tétel fölött ez a duplikátum-ellenőrzés gyors módja.

**`get_ticket(id)`** — egy tétel teljes tartalma: cím, leírás, státusz, repók, időbélyegek és
**minden bejegyzés**, mindegyiknél jelölve, honnan jött: `[user]` a te bejegyzésed a felületről,
`[agent from repo <név>]` pedig az, amit egy agent írt `update_ticket`-tel, annak a repónak a
nevével, amiben az író agent dolgozott — így az agent nem nézi válasznak a saját korábbi jegyzetét,
és látja, ha egy másik projekt agentje (pl. a frontend a backend tételére) írt. A funkció bevezetése
előtti agent-bejegyzéseknél a repó ismeretlen, ezt a kimenet jelzi is. Repofüggetlen, elég a sorszám. Akkor használja az agent, amikor ráirányítod
(„csináld meg a 12-est", „mit írtam a 7-esre?"); magától nem érkezik ide semmi, ezért nincs értelme
figyelnie.

**`update_ticket(id, repo, comment?, status?)`** — az agent visszajelzése: bejegyzést ír a tételhez, és/vagy
`folyamatban`-ra állítja. A `repo` az író agent *saját* projektje (nem feltétlenül a tételé). A bejegyzés
ugyanabba a szálba kerül, amibe te írsz, de az agent oldaláról és a repójával megjelölve, hogy a felületen látszik, melyik a tied. **Lezárni nem tud** — az azt jelentené, hogy „ezt jóváhagytam", ami a te
döntésed, és egy kattintás a felületen.

## Web UI

`http://127.0.0.1:4321`

Két egyenrangú nézet, a fejlécben a *Fal / Lista* kapcsolóval: parafa fal post-it cetlikkel, vagy
a sima lista. Mindkettőben ugyanaz az adat és ugyanazok a műveletek.

- repo és státusz szűrő, **kereső** (cím és leírás szövegében); default az aktívak
  (nyitott + folyamatban), legfrissebb elöl
- a repo szűrőben több repo is kipipálható: a kiválasztottak egymás mellett, chipként látszanak,
  és külön-külön kivehetők (üres kiválasztás = mind)
- a szűrőmenüben minden repo mellett van egy ceruza: **átnevezés**, és ha a beírt név már létezik,
  **összevonás** — ez a javítás, ha az agent egyszer másképp írta le a mappanevet
- egy tételt megnyitva: leírás (markdown), státuszváltás `nyitott → folyamatban → lezárt`,
  bejegyzés-szál, repo/cím/leírás szerkesztés, törlés
- a bejegyzéseken látszik a **forrás** (*Én* vagy *Claude*), az agent bejegyzései színes bal
  szegélyt is kapnak — a szálba mindkét oldal ír, a saját döntésed nem keveredhet össze az agent
  haladásjelentésével
- a **repo szerkeszthető**, és egy todóhoz több repo is megadható (a mező felajánlja a már létező
  neveket, de újat is beírhatsz); legalább egynek maradnia kell, különben egyik szűrőben sem látszana
- **kitűzés**: a kitűzött tételek a lista tetején maradnak (a kitűzés nem számít aktivitásnak,
  tehát nem tolja előre a tételt a levétele után sem)
- **prompt másolása**: vágólapra teszi a kész mondatot, amit az agentnek beadhatsz
- a falon a cetli sarkában hover-re előbújnak a gyorsgombok: folyamatban / lezárás / újranyitás,
  kitűzés, prompt — dialógus nyitása nélkül
- a **régóta érintetlen cetlik megsárgulnak** (két héttől két hónapig fokozatosan), a sarkuk jobban
  felkunkorodik; a lezártak nem öregszenek
- kézzel is felvehetsz todót
- **nincs automatikus frissítés**: a lista sosem változik a kezed alatt. Fél percenként viszont
  megkérdezi a szervertől, jött-e valami, és ha igen, a fejlécben megjelenik egy *N új tétel ·
  Frissítés* chip — a saját szerkesztéseid nem jelennek meg újdonságként
- az *Értesítés* gombbal (egyszer kell megnyomni) asztali értesítést is kérhetsz az új tételekről;
  csak akkor jön, ha épp nem az appot nézed

## Azure DevOps összekötés

Egy todo összeköthető **egy** Azure DevOps work itemmel, és a státuszváltás átmegy a DevOps-ba is.
A kapcsolat kizárólag itt tárolódik — a DevOps oldalán semmi nem jelzi, hogy létezik.

Beállítás a fejléc fogaskerék gombjával:

1. **Organization** (a `dev.azure.com/<organization>` névrész) és egy **hozzáférési token (PAT)**,
   Work Items olvasás + írás joggal. Projektet nem kell megadni: a work item azonosító az egész
   organizationben egyedi.
2. *Mentés és kapcsolódás* után válassz egy **minta projektet és típust** — az érvényes
   állapotnevek munkaelem-típusonként térnek el, ezért kell egy minta a legördülőkhöz. A minta nem
   tárolódik, csak a belőle kiválasztott két állapotnév.
3. Add meg, melyik DevOps állapot felel meg a **folyamatban** és a **megoldva** jelentésnek.

Ezután a work item számát vagy a teljes URL-jét megadhatod **új todo felvételekor**, és utólag is,
a megnyitott tételnél. Az összekötéskor lekérjük a jegyet (így az elgépelt szám azonnal kiderül), de
**nem írunk semmit** a DevOps-ba.

Ha megadtál work itemet, két pipa is megjelenik: a DevOps jegy **Leírása** és **Elfogadási
kritériuma** átemelhető a todo leírásába. Alapból mindkettő be van kapcsolva, mert a beemelés csak
**hozzáfűz** (soha nem ír felül), külön címsor alá — amit te írtál, az megmarad. A DevOps-ban ez a
két mező formázott szöveg, ezt markdownná alakítjuk (bekezdés, sortörés, számozott és sima lista,
kiemelés, link, táblázatcellák). Ha az adott jegynek nincs elfogadási kritériuma, egyszerűen nem
kerül be semmi.

Új todo felvételekor a két lépés sorrendje szándékos: **előbb létrejön a todo**, utána próbáljuk az
összekötést. Egy elgépelt szám így nem viszi el a frissen megírt jegyzetet — a todo megmarad, a
hibaüzenet pedig ezt meg is mondja.

A leképezés:

| Itt | Azure DevOps |
|---|---|
| nyitott | — (soha nem ír) |
| folyamatban | a beállított „folyamatban" állapot |
| lezárt | a beállított „megoldva" állapot |

Visszafelé is működik: egy lezárt tétel folyamatban-ra állítása a work itemet is visszaviszi. A
*nyitott* állapotnak nincs párja, tehát `lezárt → nyitott` esetén a work item megoldva marad.

Amit érdemes tudni:

- **A kiírás felülír.** Ha közben valaki kézzel továbbvitte a work itemet, a következő státuszváltás
  visszahúzza — ez a fal a forrás.
- **A helyi státusz sosem függ a DevOps-tól.** Ha a kiírás elhasal (nincs hálózat, lejárt token,
  a típus nem ismeri az adott állapotot), a tétel itt akkor is átáll, a hiba pedig rákerül a
  jegyre: a cetlin és a lista sorában piros jelzés, a megnyitott tételben a hibaüzenet és egy
  *Újra* gomb. Automatikus újrapróbálkozás nincs.
- **Az agent is mozgathatja.** Ha az `update_ticket`-tel folyamatban-ra állít egy összekötött
  tételt, a kiírás elindul, de az agent nem várja meg — egy sikertelen kiírás így csak a következő
  *Frissítés*nél tűnik fel.
- **Egy work item egy todóhoz tartozhat**, különben az első lezárás megoldottra állítaná a jegyet,
  miközben a másik todo még nyitva van.
- **Egy todo egy work itemhez tartozhat.** A leválasztás és a todo törlése sem nyúl a DevOps-hoz.
- A PAT titkosítatlanul kerül a közös `~/.todo-mcp/todos.db` fájlba, és a szerver soha nem adja
  vissza — csak azt, hogy van-e elmentve.

## Telepítés alkalmazásként

A UI telepíthető webalkalmazás (PWA), így külön ablakban, saját ikonnal indul, böngészősáv nélkül.

- **Telepítés**: nyisd meg a `http://127.0.0.1:4321`-et, és nyomd meg a fejlécben a *Telepítés*
  gombot (vagy Chrome/Edge: címsor jobb szélén a telepítés ikon → *Telepítés*). A loopback origó
  biztonságos kontextusnak számít, ezért nem kell HTTPS.
- **Eltávolítás**: az alkalmazás ablakában `⋮` → *Eltávolítás*, vagy Windows *Alkalmazások* lista.
- **Ha nem fut a szerver**: az app így is elindul a mentett állapotból, és a fejlécben jelzi, hogy
  *Mentett adatok – a szerver nem fut*. Szerkeszteni ilyenkor nem lehet (a mentés hibát ad),
  a mentett todók csak olvashatók. Indítsd el az `npm start`-ot, majd *Frissítés*.
- **Új verzió**: build után az app alján felajánlja az *Újratöltés*t; sosem tölt újra magától.

Semmi nem töltődik le a hálózatról: az ikonok, a betűkészlet-stack és a textúrák mind helyben
készülnek, így az app offline is ugyanúgy néz ki.

Ha ennél is kényelmesebb, magától induló megoldást szeretnél — natív ablak, tálcaikon,
Windows-bejelentkezéskor automatikus indítás —, azt nem a PWA, hanem az alábbi vastag kliens adja.

## Vastag kliens (Electron)

A szerver-mód és a PWA mellett a projekt egy telepíthető Windows alkalmazásként is buildelhető,
ugyanabból a kódbázisból, fork nélkül — ez egy harmadik, opcionális build-kimenet, ami semmiben nem
érinti azokat, akik a todo-mcp-t csak szerverként (`npm start`) futtatják.

A vastag kliens egy Electron-ablak, ami a szervert **saját magában, egy folyamaton belül** indítja
el (a célgépen nem kell hozzá külön telepített Node.js, mert Electron a sajátját hozza), tálcaikonként
fut a háttérben, és igény szerint Windows-bejelentkezéskor magától elindul.

- **Fejlesztői futtatás**: `npm run dev:desktop` — buildeli a szervert és a UI-t, lefordítja az
  Electron shellt, majd megnyitja az ablakot.
- **Telepítő készítése**: `npm run build:desktop` — a `release/` mappába egy NSIS telepítőt csomagol
  (`Todo MCP Setup <verzió>.exe`). Telepítés után a program a rendszer Node-jától függetlenül fut.
- **Tálcamenü**: *Megnyitás*, *Indítás Windows-szal* (jelölőnégyzet, alapból kikapcsolva), *Kilépés*.
  Az ablak bezárása (✕) csak tálcára rejti az appot, nem lép ki — a *Kilépés* menüpont a valódi
  kilépés, ami tisztán leállítja a beépített szervert is.
- **Adatmegosztás**: a vastag kliens ugyanazt a `~/.todo-mcp/todos.db` fájlt és `4321`-es portot
  használja, mint az `npm start`. Ha a gépen már fut egy szerver-mód példány, az induló Electron
  ablak ahhoz csatlakozik, ahelyett hogy másikat indítana — kilépéskor sem állítja le, mert nem az övé.
- Jelenleg csak Windows-ra csomagolható (`electron-builder --win`).

## Fejlesztés

```bash
npm start              # szerver (API + MCP), a buildelt UI-t is kiszolgálja
npm run dev:web        # Vite dev szerver HMR-rel, /api proxyval a fenti szerverre
npm run build          # tsc (szerver) + tsc --noEmit (web) + vite build
npm run icons          # PWA ikonok + a vastag kliens .ico-jának újragenerálása
npm run dev:desktop    # Electron vastag kliens, fejlesztői futtatás
npm run build:desktop  # Windows NSIS telepítő csomagolása a release/ mappába
```

A service worker csak a buildelt appban regisztrálódik, `dev:web` alatt nem — így a HMR-t nem
zavarja cache.

Nincs automata teszt; a típusellenőrzés a `npm run build`-ban fut.

Forrásfák: `src/` a szerver (`repo.ts`-ben minden SQL, ezen keresztül megy az MCP és az API is),
`web/` a React SPA, `electron/` a vastag kliens shell-je.
