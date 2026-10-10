# AI csapat – tervkivonat

*Összeállítva: 2026-10-10 · Állapot: tervezés, a megvalósítás még nem kezdődött el*

## 1. Cél

A development department manager napi munkájának tehermentesítése egy AI ügynökcsapattal. A csapat feldolgozza a leveleket, a Teams üzeneteket és a naptárat, válaszokat készít elő, az új igényeket pedig jóváhagyás után végigviszi a requirementektől az Azure DevOps jegyekig.

## 2. Alapelvek

- **Ember a döntési pontokon:** levelet az ügynökök nem küldenek, csak piszkozatot írnak. Új igény csak jóváhagyás után indul.
- **Egy ütemezett belépési pont:** csak az Asszisztens fut ütemezetten. Minden más igény szerint indul.
- **Egy ügynök, egy felelősség:** szűk fókuszú szerepek.
- **A wikibe csak a Librarian ír**, a többiek csak olvassák.
- **Hordozhatóság:** minden egy git repóban van, telepítő szkripttel.
- **Futtatási környezet:** a céges laptop. A felhős (self-hosted) változatot a hardverlehetőségek áttekintése után elvetettük.

## 3. A csapat

| Ügynök | Hogyan fut | Feladat |
|---|---|---|
| **Asszisztens** | Ütemezetten, a Claude desktop app ütemezett feladataként | Olvassa a leveleket, a Teams üzeneteket és a naptárat. Válaszpiszkozatot ír a manager nevében az Outlookba. Információgyűjtéshez subagentként indíthatja a Librariant, a BA-t, az Architectet és a Scrum Mastert. Az új igényeket és feladatokat javaslatként (proposal) beküldi a jóváhagyó oldalra. |
| **Project Manager (PM)** | API hívásra, a jóváhagyás után | Egy-egy új igény vagy feladat teljes útját vezényli. A Librariant, a BA-t, az Architectet és a Scrum Mastert subagentként indítja. Az Asszisztenst nem indíthatja. |
| **Librarian** | Subagent | Projektenként egy Karpathy-féle LLM wiki tudástárat vezet. Elraktározza az információt, és kikeresi más ügynököknek. Műveletei: ingest, query, lint. |
| **Business Analyst** | Subagent | Az üzleti igényekből fejlesztési requirementek lesznek: user story, elfogadási kritériumok, PRD. |
| **Architect** | Subagent | Technológiai terveket készít elő (terv, ADR), és fejlesztői jegyekre bontja a munkát. |
| **Scrum Master** | Subagent | Kezeli és karbantartja az Azure DevOps jegyeket: létrehozás, ütemezés, sprintbe sorolás, státusz. |

**Technikai korlát:** egy subagent nem indíthat további subagentet, csak egy szintű a hierarchia. Ezért a PM nem lehet az Asszisztens subagentje. A PM önálló folyamatként indul, a jóváhagyó oldal API hívására.

## 4. Működés

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
       ├─► BA / Architect
       └─► Scrum Master ──► Azure DevOps (MCP)
       │
       └─ státusz, kérdések és eredmények vissza a web appba (API)
```

### Egy javaslat életútja

`proposed` → `approved` / `rejected` / `revision_requested` → `in_progress` → `waiting_for_input` → `done`

- **Jóváhagyás:** a szerver elindítja a PM-et. Egyszerre egy PM fut, a többi jóváhagyott javaslat sorban vár.
- **Átdolgozás:** a manager megjegyzést ír, és a javaslat visszakerül az Asszisztenshez.
- **Elvetés:** a javaslat lezárul, az indoklás megmarad az előzmények között.
- **Kérdés a PM-től:** a javaslat `waiting_for_input` állapotba kerül, és a manager az oldalon válaszol.
- **Eredmény:** a requirementek, a terv és a létrehozott jegyek linkjei a javaslat lapján jelennek meg.

### Egy javaslat adatai

Cím, projekt, forrás (link a levélre vagy Teams üzenetre), összefoglaló, javasolt hatókör, prioritás, állapot, megjegyzések, előzmények.

## 5. Tudástár (Karpathy-féle LLM wiki)

Projektenként egy wiki:

```
wiki/<projekt>/
  raw/        ← nyers források (levelek, jegyzetek, dokumentumok)
  pages/      ← a Librarian által karbantartott oldalak (entitások, döntések, fogalmak)
  index.md    ← tartalomjegyzék
  log.md      ← időrendi napló a változásokról
```

- **ingest:** új anyag feldolgozása, a kapcsolódó oldalak frissítése.
- **query:** válasz más ügynökök kérdéseire a wiki alapján.
- **lint:** ellentmondások, elavult és árva oldalak keresése, rendszeresen.
- Mivel a Librariant az Asszisztens és a PM is indíthatja, írás előtt zárol (lock fájl), és minden változtatást git commitként rögzít.

## 6. Repó szerkezete

```
ai-team/                  ← egyetlen git repó (később Azure DevOps Repos)
  approval-app/           ← Node szerver, SQLite, webes felület, PM-indító
  workspace/
    CLAUDE.md             ← közös csapatszabályok
    .claude/agents/       ← librarian.md, analyst.md, architect.md, scrum-master.md
    roles/                ← assistant.md, pm.md
    .mcp.json             ← Azure DevOps MCP csatlakozó
  wiki/                   ← tudástár (később külön repó lehet)
  setup.ps1               ← telepítés új gépen
  .env.example            ← minta a titkokhoz (a valódi .env nincs a gitben)
  Dockerfile, docker-compose.yml   ← opcionális, egy későbbi szerverre költözéshez
```

## 7. Költözés másik gépre

**Előfeltétel:** Node (a mostani gépen v24), git, Claude Code CLI és a Claude desktop app, bejelentkezve.

1. `git clone <repó>`
2. A `.env` átvitele biztonságos úton (Azure DevOps token, helyi API token).
3. A `setup.ps1` futtatása: `npm install`, az adatbázis létrehozása, a web szerver felvétele a Windows indításkor futó feladatai közé.
4. Az Asszisztens ütemezett feladatának létrehozása a desktop appban, a `roles/assistant.md` alapján.
5. A jóváhagyó oldal adatbázisa (SQLite) egyetlen fájl, mentésből visszamásolható.

**Docker és WSL:** nem ezekre építünk. Az Asszisztens mindenképp a gazdagépen fut a desktop app csatlakozói miatt. A céges gépen mindkettőhöz rendszergazdai jog kell, a Docker Desktophoz pedig nagyobb cégnél licenc is. A Docker fájlok csak tartalékként kerülnek a repóba.

## 8. Üzemeltetési szempontok

- A laptopnak ébren kell lennie és a desktop appnak nyitva. Az ébren tartás (keep-awake) bekapcsolható. Hogy egy alvás miatt kimaradt futás pótlódik-e, azt tesztelni kell.
- A web szerver csak a `127.0.0.1` címen figyel. Az Asszisztens egy helyi tokennel hívja.
- Minden ügynökfutást naplózni kell: mit csinált, milyen eszközöket hívott, mennyibe került.
- Egyeztetni kell az IT-val, hogy a helyi szerver futtatása és a céges levelezés feldolgozása Claude-dal belefér-e a szabályzatba.

## 9. Bevezetési sorrend

1. Repó váz, `CLAUDE.md`, szerepleírások.
2. Jóváhagyó web app (API és felület).
3. Asszisztens és Librarian, tesztelés valódi leveleken.
4. PM a BA-val és az Architecttel.
5. Scrum Master és az Azure DevOps bekötése.
6. Telepítő szkript, költözési próba.

## 10. Nyitott kérdések

- [ ] A repó helye a gépen
- [ ] Azure DevOps organization és project; belépés személyes tokennel (PAT) vagy böngészős bejelentkezéssel
- [ ] A fő projektek listája a wikikhez
- [ ] A Scrum Master önállósága: hozzon létre jegyeket `ai-proposed` címkével, vagy csak javasoljon
- [ ] Az Asszisztens ütemezése (javaslat: hétköznap 7:00, 12:00, 16:00)
- [ ] IT szabályzat egyeztetése
