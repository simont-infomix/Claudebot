# ClaudeBot

Windows tálca-alkalmazás, amely **több Claude Code botot futtat, ütemez és felügyel** egy helyen.
Minden bot egy önálló `claude.exe` munkamenet a saját munkamappájában — headlessen, konzolablak
nélkül —, az alkalmazáson belül pedig mindegyik saját chat-felületet, beállításokat és ütemezett
feladatokat kap.

> **Állapot:** v1.0.0 — első kiadás.

## Mit tud

| Terület | Részletek |
|---|---|
| **Több bot egyszerre** | Botonként saját chat fájlcsatolással (drag & drop és vágólap), avatar, átnevezés, munkamappa. A bot bármikor leállítható, újraindítható, törölhető. |
| **Ütemezett feladatok** | Botonként több feladat: időzítés, szüneteltetés, azonnali kézi futtatás, futás-előzmény. Az esedékességet pollozó időzítő figyeli, a számolt következő futással (ADR-0001). |
| **Interaktív tool-jóváhagyás** | Ha a bot olyan eszközt használna, amire nincs előzetes engedélye, a csevegésben rákérdez — nem némán elutasításra kerül (ADR-0004). Kétszintű határidővel: ütemezett körnél rövidebb, mert ott tipikusan nincs a gép előtt senki. |
| **A bot kérdései** | Az `AskUserQuestion` eszköz kérdései kártyaként jelennek meg a chatben, opciókkal, akár többszörös választással — a válasz visszajut a bothoz. |
| **Bot-bot üzenetcsatorna** | Egy bot feladatot delegálhat annak a botnak, amelyik ért hozzá, és megkapja a válaszát — a felhasználónak nem kell üzeneteket másolgatnia a csevegések között. A forgalom mindkét fél chatjében látszik, botonként kikapcsolható (ADR-0005). |
| **Megosztott képességek** | A közös `Bots/.claude/` mappa skilljeit és sub agentjeit minden bot eléri, botonkénti másolás nélkül. |
| **Tálcaműködés** | Az ablak bezárása a tálcára rejt, az automatikus Windows-indítás kapcsolható (ADR-0003). Olvasatlan bot-üzenetnél a tálcaikon és a tálcagomb is jelez. |
| **Bot-onkénti futási beállítások** | Model, effort, permission mode, engedélyezett tool-minták, interaktív jóváhagyás, csatorna-részvétel. |

## Hogyan működik

```
┌─────────────────────── ClaudeBotApp.exe (egyetlen folyamat) ───────────────────────┐
│                                                                                     │
│   React UI  ──JS bridge──  WinForms host                                            │
│  (WebView2)                 ├─ BotSessionManager ─┬─ BotSession ──► claude.exe #1   │
│                             │                     └─ BotSession ──► claude.exe #2   │
│                             ├─ BotTaskScheduler        stdin/stdout: stream-json     │
│                             │                          + control-protokoll (jóváh.)  │
│                             ├─ ChannelMcpServer ◄──── MCP tool-hívás HTTP-n ────┘   │
│                             └─ BotMessageBus      (127.0.0.1, dinamikus port)        │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │                                              │
          ▼                                              ▼
   Bots/<botnév>/            ← a claude.exe munkakönyvtára: agent.md, .claude/, fájlok
   Bots/.claude/             ← minden bot között megosztott skillek és sub agentek
```

A host a `claude.exe`-vel három csatornán beszél: **prompt** (stdin), **esemény-folyam** (stdout,
`stream-json`), és a **control-protokoll** a jóváhagyási kérésekhez. A negyedik irány fordított: a
bot hívja a hosztot — a bot-csatorna MCP szerverén keresztül, mert a CLI-ből a tool-hívás az
egyetlen tiszta út a hoszt felé.

## Telepítés

### Kész csomagból

A [Releases](../../releases) oldalról töltsd le a `ClaudeBot-<verzió>-win-x64.zip`-et, csomagold
ki, és indítsd a `ClaudeBotApp.exe`-t. A csomag **self-contained**: .NET runtime telepítése nem
szükséges.

Előfeltételek a gépen:

1. **Claude Code CLI, natív telepítéssel** (`claude.exe`), bejelentkezve. Az alkalmazás induláskor
   megkeresi — előbb a `CLAUDEBOT_CLI_PATH` környezeti változót (ha be van állítva, az dönt), majd
   a `PATH` bejegyzéseit, végül a natív telepítő alapértelmezett helyét
   (`%USERPROFILE%\.local\bin`). Ha nem találja, egy hibaüzenet után **el sem indul**. Az npm-es
   telepítés (`claude.cmd`) nem elég: a headless indítás natív `claude.exe`-t igényel.
2. **WebView2 Runtime** — Windows 10/11-en jellemzően előre telepítve.

### Költözés másik gépre

Az alkalmazás mappája önhordó. A botok átviteléhez másold át a `Bots/` mappát is: a munkamappák,
az `agent.md`-k, a beállítások és az ütemezett feladatok hordozhatók, a beszélgetés-előzmény nem
(az a `claude.exe` session-jében él). A botok engedélylistájában hivatkozott globális MCP-szervereket
(pl. Azure DevOps) a célgépen is be kell állítani.

## Fejlesztés

Szükséges: **.NET 10 SDK**, **Node.js** (npm), és a Claude Code CLI a futtatáshoz.

```powershell
# Debug build (framework-dependent, gyors)
dotnet build ClaudeBotApp/ClaudeBotApp.csproj

# Release build (self-contained, win-x64 — ez a kiadható csomag)
dotnet build ClaudeBotApp/ClaudeBotApp.csproj -c Release
```

A React UI buildje a csproj targetjéből automatikusan lefut (`npm install` az első alkalommal,
majd `npm run build`), és a kimenet a `webui/` mappába kerül az exe mellé. Külön is futtatható a
`ClaudeBotApp/react-ui/` könyvtárból.

> ⚠️ A `ClaudeBotApp/clean-rebuild.ps1` **törli a teljes `bin` mappát**, amiben a botok
> munkamappái (`Bots/`) is élnek. Csak akkor futtasd, ha előbb kimentetted őket.

Hibakereséshez minden bot munkamappájában készül egy `claudebot-stream.log`, benne a `claude.exe`
felé és felől menő összes nyers JSON-sor.

## Repó szerkezete

```
ClaudeBotApp/            # A WinForms host (C#, .NET 10)
  react-ui/              # A felhasználói felület (React + TypeScript, Vite)
  BotTemplate/           # Sablon-skillek bot workspace-hez — kézi másolásra; a kód jelenleg
                         #   nem használja (új bot üres munkamappával jön létre)
docs/                    # A formális dokumentumkészlet (lásd lent)
specification.md         # Az eredeti, informális vázlat — történeti, nem karbantartott
```

## Dokumentáció

A `docs/` mappa a projekt formális dokumentumkészlete, a `docs/Index.md` a tartalomjegyzéke:

- **Use case-ek** (`docs/use-cases/`) — mit ér el a felhasználó, lépésről lépésre;
- **Döntések** (`docs/adr/`, összesítve: `docs/Decision_list.md`) — a jelentős technikai döntések
  indoklása és az elvetett alternatívák;
- **Architektúra** (`docs/architecture-c1.md`, `architecture-c2/`, `architecture-c3/`) — C4-modell
  szerinti diagramok;
- **UI design szabályzat** (`docs/ui-design-guideline.md`);
- **Hibák** (`docs/bugs/`) — a feltárt hibák leírása és a javításuk kontextusa.

A dokumentumok karbantartásának szabályait (frontmatter, elnevezés, mikor kell új use case vagy
ADR) a `docs/CLAUDE.md` rögzíti.
