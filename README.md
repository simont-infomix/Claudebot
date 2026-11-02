# AI csapat

AI ügynökcsapat, amely a development department manager napi munkáját tehermenesíti: feldolgozza a leveleket, a Teams üzeneteket és a naptárat, válaszokat készít elő, az új igényeket pedig jóváhagyás után kidolgoztatja — a requirementektől az előkészített Azure DevOps jegyekig —, majd a kész anyagot átadja a humán szoftverfejlesztőknek. A fejlesztést magát nem a csapat végzi.

> **Állapot:** tervezés, a megvalósítás még nem kezdődött el.

## Alapelvek

- **Ember a döntési pontokon:** levelet az ügynökök nem küldenek, csak piszkozatot írnak. Új igény csak jóváhagyás után indul.
- **Egy ütemezett belépési pont:** csak az Asszisztens fut ütemezetten. Minden más igény szerint indul.
- **Egy ügynök, egy felelősség:** szűk fókuszú szerepek.
- **A wikibe csak a Librarian ír**, a többiek csak olvassák.
- **Hordozhatóság:** minden egy git repóban van, telepítő szkripttel.
- **Futtatási környezet:** a céges laptop. A felhős (self-hosted) változatot a hardverlehetőségek áttekintése után elvetettük.

## A csapat

| Ügynök | Hogyan fut | Feladat |
|---|---|---|
| **Asszisztens** | Ütemezetten, a Claude desktop app ütemezett feladataként | Olvassa a leveleket, a Teams üzeneteket és a naptárat. Válaszpiszkozatot ír a manager nevében az Outlookba. Információgyűjtéshez subagentként indíthatja a Librariant, a BA-t, az Architectet és a Scrum Mastert. Az új igényeket és feladatokat javaslatként (proposal) beküldi a jóváhagyó oldalra. |
| **Project Manager (PM)** | API hívásra, a jóváhagyás után | Egy-egy új igény vagy feladat kidolgoztatásáért felel: összegyűjti a szükséges információkat, és a requirementeket, a tervet és az Azure DevOps jegyeket előkészítteti. A fejlesztést magát nem vezényli — a kész jegyeket a humán szoftverfejlesztőknek adja át. A Librariant, a BA-t, az Architectet és a Scrum Mastert subagentként indítja. Az Asszisztenst nem indíthatja. |
| **Librarian** | Subagent | Projektenként egy Karpathy-féle LLM wiki tudástárat vezet. Elraktározza az információt, és kikeresi más ügynököknek. Műveletei: ingest, query, lint. |
| **Business Analyst** | Subagent | Az üzleti igényből és az Architect megvalósíthatósági visszajelzéséből fejlesztési requirementek lesznek: user story, elfogadási kritériumok, PRD. Az Architecttel iteratívan dolgozik. |
| **Architect** | Subagent | Már a requirementek előtt felméri a megvalósítási lehetőségeket, majd a BA-val iteratívan finomítva technológiai terveket készít elő (terv, ADR), és fejlesztői jegyekre bontja a munkát. |
| **Scrum Master** | Subagent | Kezeli és karbantartja az Azure DevOps jegyeket: létrehozás, ütemezés, sprintbe sorolás, státusz. |

**Technikai korlát:** egy subagent nem indíthat további subagentet, csak egy szintű a hierarchia. Ezért a PM nem lehet az Asszisztens subagentje. A PM önálló folyamatként indul, a jóváhagyó oldal API hívására.

## Architektúra

```
 Claude desktop app
 ⏰ ütemezett feladat ──► [Asszisztens]
                           │ Outlook / Teams / naptár: a desktop app csatlakozóival
                           │ subagentek: Librarian · BA · Architect · Scrum Master
                           │ válaszpiszkozat az Outlookba
                           │
                           │ POST http://127.0.0.1:4100/api/proposals
                           ▼
 [Helyi jóváhagyó web app]  Node szerver + SQLite, csak localhoston
    böngészőben: jóváhagy / átdolgoz / elvet
                           │ jóváhagyáskor
                           ▼
 [PM]  a szerver elindítja:  claude -p "<PM szerep + igény>"
       a munkaterület mappájában
       ├─► Librarian ──► wiki (git repó)
       ├─► BA ⇄ Architect  (iteratív egyeztetés, lásd lent)
       └─► Scrum Master ──► Azure DevOps (MCP)
       │
       └─ státusz, kérdések és eredmények vissza a web appba (API)
```

### BA és Architect: tyúk-tojás probléma

A Business Analyst és az Architect nem egymás után, lineárisan dolgozik. A BA-nak a requirementek megírásához nem csak az üzleti igényt kell ismernie, hanem azt is, mi valósítható meg egyáltalán és milyen áron — ehhez az Architect inputja kell. Az Architectnek viszont a tervhez a BA által pontosított requirementek kellenek. Ezért az Architect jellemzően **korábban** száll be, mint a BA: először egy nagyvonalú megvalósíthatósági körképet ad, a BA ez alapján és az üzleti igény alapján megírja a requirementeket, az Architect ezekből tervet készít, és ha közben újabb kérdés vagy korlát merül fel, a kör megismétlődik.

A PM feladata ezt az iterációt vezényelni: oda-vissza futtatja a BA-t és az Architectet, amíg a requirementek és a terv konzisztensek és megvalósíthatóak lesznek, és eldönti, mikor elég jó ez a konvergencia ahhoz, hogy a Scrum Master jegyeket készíthessen belőle.

### Egy javaslat életútja

`proposed` → `approved` / `rejected` / `revision_requested` → `in_progress` → `waiting_for_input` → `done`

- **Jóváhagyás:** a szerver elindítja a PM-et. Egyszerre egy PM fut, a többi jóváhagyott javaslat sorban vár.
- **Átdolgozás:** a manager megjegyzést ír, és a javaslat visszakerül az Asszisztenshez.
- **Elvetés:** a javaslat lezárul, az indoklás megmarad az előzmények között.
- **Kérdés a PM-től:** a javaslat `waiting_for_input` állapotba kerül, és a manager az oldalon válaszol.
- **Eredmény:** a requirementek, a terv és a létrehozott jegyek linkjei a javaslat lapján jelennek meg.

### Egy javaslat adatai

Cím, projekt, forrás (link a levélre vagy Teams üzenetre), összefoglaló, javasolt hatókör, prioritás, állapot, megjegyzések, előzmények.

## Tudástár (Karpathy-féle LLM wiki)

Projektenként egy wiki, **saját, önálló git repóban**:

```
wiki/<projekt>/   ← önálló git repó
  raw/        ← nyers források (levelek, jegyzetek, dokumentumok)
  pages/      ← a Librarian által karbantartott oldalak (entitások, döntések, fogalmak)
  index.md    ← tartalomjegyzék
  log.md      ← időrendi napló a változásokról
```

Mivel minden wiki saját git repó a fő `ai-team` repón belül, ez **"git a git-ben"** felállást eredményez: a gyökér `.gitignore` kizárja a `wiki/` mappa tartalmát a fő repó verziókövetéséből, így a beágyazott wiki-repók teljesen függetlenül élnek, és a fő repó nem próbálja kezelni őket.

- **ingest:** új anyag feldolgozása, a kapcsolódó oldalak frissítése.
- **query:** válasz más ügynökök kérdéseire a wiki alapján.
- **lint:** ellentmondások, elavult és árva oldalak keresése, rendszeresen.
- Mivel a Librariant az Asszisztens és a PM is indíthatja, írás előtt zárol (lock fájl), és minden változtatást a projekt saját wiki-repójába commitol.

## Repó szerkezete

```
ai-team/                  ← egyetlen git repó (később Azure DevOps Repos)
  approval-app/           ← Node szerver, SQLite, webes felület, PM-indító
  workspace/
    CLAUDE.md             ← közös csapatszabályok
    .claude/agents/       ← librarian.md, analyst.md, architect.md, scrum-master.md
    roles/                ← assistant.md, pm.md
    .mcp.json             ← Azure DevOps MCP csatlakozó
  wiki/<projekt>/         ← projektenként ÖNÁLLÓ git repó, a .gitignore kizárja a fő repóból
  .gitignore              ← kizárja a wiki/ tartalmát (git a git-ben felállás)
  setup.ps1               ← telepítés új gépen
  .env.example            ← minta a titkokhoz (a valódi .env nincs a gitben)
  Dockerfile, docker-compose.yml   ← opcionális, egy későbbi szerverre költözéshez
```

## Telepítés / költözés másik gépre

**Előfeltétel:** Node (a mostani gépen v24), git, Claude Code CLI és a Claude desktop app, bejelentkezve.

1. `git clone <repó>`
2. A `.env` átvitele biztonságos úton (Azure DevOps token, helyi API token).
3. A `setup.ps1` futtatása: `npm install`, az adatbázis létrehozása, a web szerver felvétele a Windows indításkor futó feladatai közé.
4. Az Asszisztens ütemezett feladatának létrehozása a desktop appban, a `roles/assistant.md` alapján.
5. A jóváhagyó oldal adatbázisa (SQLite) egyetlen fájl, mentésből visszamásolható.

**Docker és WSL:** nem ezekre építünk. Az Asszisztens mindenképp a gazdagépen fut a desktop app csatlakozói miatt. A céges gépen mindkettőhöz rendszergazdai jog kell, a Docker Desktophoz pedig nagyobb cégnél licenc is. A Docker fájlok csak tartalékként kerülnek a repóba.

## Üzemeltetési szempontok

- A laptopnak ébren kell lennie és a desktop appnak nyitva. Az ébren tartás (keep-awake) bekapcsolható. Hogy egy alvás miatt kimaradt futás pótlódik-e, azt tesztelni kell.
- A web szerver csak a `127.0.0.1` címen figyel. Az Asszisztens egy helyi tokennel hívja.
- Minden ügynökfutást naplózni kell: mit csinált, milyen eszközöket hívott, mennyibe került.
- Egyeztetni kell az IT-val, hogy a helyi szerver futtatása és a céges levelezés feldolgozása Claude-dal belefér-e a szabályzatba.

## Bevezetési sorrend

1. Repó váz, `CLAUDE.md`, szerepleírások.
2. Jóváhagyó web app (API és felület).
3. Asszisztens és Librarian, tesztelés valódi leveleken.
4. PM a BA-val és az Architecttel.
5. Scrum Master és az Azure DevOps bekötése.
6. Telepítő szkript, költözési próba.

## ClaudeBot — önálló termék ugyanebben a repóban

> **Állapot:** POC / aktív fejlesztés.

A `ClaudeBot/` mappában egy **önálló, különálló alkalmazás** lakik: egy Windows asztali tálca-app,
amely egy vagy több `claude.exe` (Claude Code CLI) subprocesst futtat headlessen (nincs
konzolablak), mindegyiket egy saját munkaterület-mappához kötve, és mindegyikhez saját,
egyedi chat-felületet ad az alkalmazáson belül. Az ötlet a fenti Asszisztens-koncepcióból
(levél/Teams-triázs, draft-only, ember a döntési pontokon) indult ki, de **nem annak kiterjesztése**
— saját kódbázis, saját futtatási infrastruktúra, ugyanebben a git repóban.

**Architektúra (4 container):**

| Komponens | Technológia | Felelősség |
|---|---|---|
| WinForms Host | .NET 10, C# WinForms | Egyetlen folyamat: a WebView2-t hosztolja, indítja/felügyeli a bot-session-öket (subprocesseket). |
| React UI | React, WebView2-n megjelenítve | A teljes felület: bot-választó sáv (Sidebar), chat-nézet fájlcsatolással, beállítások (SettingsView), bot-kontextusmenü. Egy JS bridge-en (`WebViewBridge`) keresztül kommunikál a hosttal. |
| Bot workspace | Helyi fájlrendszer | Botonként egy almappa — ez a `claude.exe` munkakönyvtára, benne a skill-ek/agent-configok (`BotTemplate/`). |
| Claude Code CLI session | `claude.exe`, headless, `stream-json` | Botonként egy önálló, hosszú életű subprocess, ami a tényleges agent-logikát futtatja; stdin/stdout JSON-sorokon kommunikál a hosttal. |

**Jelenlegi funkciók (POC):**
- Több bot egyidejű indítása és felügyelete (multi-bot host)
- Chat-felület botonként, fájlcsatolással (drag&drop + vágólap)
- Bot-kontextusmenü (jobbklikk): terminál-munkamenet megnyitása, munkamappa megnyitása Intézőben
- Beállítások nézet (SettingsView)
- Bot-sablon (`BotTemplate/`) a munkaterület alapértelmezett `.claude/skills` tartalmához

**Telepítés / költözés másik gépre:**

A Release build **self-contained**: a .NET futtatókörnyezet (beleértve az ASP.NET Core részt, amit
a bot-csatorna Kestrelje igényel) a kimeneti mappában van, így a célgépre semmilyen .NET runtime-ot
nem kell telepíteni. A `dotnet build -c Release` kimenete (`ClaudeBotApp/bin/Release/net10.0-windows/`)
önmagában átmásolható.

Amire a célgépen szükség van:

1. **Claude Code CLI, natív telepítéssel** (`claude.exe`) — bejelentkezve. Az alkalmazás induláskor
   megkeresi: előbb a `CLAUDEBOT_CLI_PATH` környezeti változót (ha be van állítva, az dönt), majd a
   `PATH` bejegyzéseit, végül a natív telepítő alapértelmezett helyét (`%USERPROFILE%\.local\bin`).
   Ha nincs meg, egy hibaüzenet után **el sem indul** — így nem botonkénti, érthetetlen hibaként
   jelentkezik a hiány. Az npm-es telepítés (`claude.cmd`) **nem elég**: a headless indítás natív
   `claude.exe`-t igényel, de a hibaüzenet külön jelzi, ha ilyet talált a gépen.
2. **WebView2 Runtime** (Windows 10/11-en jellemzően előre telepítve).
3. A **`Bots/` mappa** átmásolása a kimeneti mappába, ha a meglévő botokat (beszélgetés-előzmény
   nélkül: munkamappa, `agent.md`, beállítások, ütemezett feladatok) vinni szeretnéd.
4. A botok engedélylistájában hivatkozott **globális MCP-szerverek** (pl. Azure DevOps) beállítása a
   célgépen.

**Dokumentáció:** a részletes terv és a formális specifikációs dokumentumok a `ClaudeBot/` mappában
élnek, külön a fenti tudástár-rendszertől:
- `ClaudeBot/specification.md` — az eredeti, informális terv (v1 hatókör, architektúra, elvetett alternatívák)
- `ClaudeBot/docs/Index.md` — a formális dokumentumkészlet tartalomjegyzéke: use case-ek (UC-001–004),
  C1/C2/C3 architektúra-diagramok, UI design szabályzat
