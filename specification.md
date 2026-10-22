# ClaudeBot — specifikáció

> **Állapot:** tervezés / POC-kialakítás, a megvalósítás még nem kezdődött el.

## Mi ez

Egy Windows asztali alkalmazás (tálcaikonos háttér-app), amely egy vagy több `claude.exe`
subprocesst futtat **headlessen** (nincs konzolablak), mindegyiket egy saját munkaterület-mappához
kötve. Minden ilyen agent saját, egyedi chat-felületet kap az alkalmazáson belül — nem a Claude Code
natív terminál-UI-ját használjuk, hanem egy teljesen saját felületet építünk a `claude.exe`
stdin/stdout-ján keresztül.

Az első konkrét használati eset: a mai, levelezést/Teams-et triázsoló **Asszisztens**-koncepció
kibővítése egy **önállóan vezetett, személyes TODO-listává** — az agent magától átolvassa az új
leveleket és Teams-üzeneteket, karbantart egy teendőlistát, javaslatokat tesz, emlékeztet a
megválaszolatlan üzenetekre, miközben a felhasználó bármikor beleszólhat chaten keresztül.

**Viszony a meglévő "AI csapat" rendszerhez** (lásd a repó gyökér `README.md`-jét): a ClaudeBot egy
**önálló, különálló termék**, nem annak a rendszernek a kiterjesztése. Az ottani Asszisztens
(`.claude/agents/assistant.md`) a saját, requirement-feldolgozó pipeline-jának (jóváhagyó app →
PM → BA/Architect/Scrum Master) a belépési pontja, a `127.0.0.1:4100` jóváhagyó appra küld
javaslatokat. A ClaudeBot ettől függetlenül, saját munkaterületen, saját agent-definícióval fut — a
*koncepciót* (levél/Teams-triázs, draft-only, emberi jóváhagyás a döntési pontokon) öröklia tőle, a
kódot és a futtatási infrastruktúrát nem.

## Alapelvek

- **Nincs konzolablak.** A `claude.exe` mindig headlessen, átirányított stdin/stdout-tal fut; a
  felhasználó a saját WPF chat-ablakon keresztül kommunikál vele, sosem terminálban.
- **A TODO-lista a tartós memória, nem a chat-kontextus.** Egy session nem él a végtelenségig —
  a listaállapot egy külső, perzisztens store-ban van, amit minden futás (ütemezett és ad-hoc is)
  olvas/ír. Ez korlátozza a kontextusméretet és a költséget, és túléli az app újraindítását is.
- **Ember a küldési pontokon.** A ClaudeBot sosem küld el emailt vagy Teams-üzenetet magától —
  ez a mai Asszisztens elvének folytatása ClaudeBot-ra nézve is.
- **Minimális, elszigetelt tool-felszín agentenként.** Nincs globális MCP-regisztráció; minden
  `claude.exe` indítás `--strict-mcp-config`-gal, session-szinten bedrótozott, szűk tool-készletet
  kap — más projektek MCP-szerverei (azure-devops, a valódi todo-mcp stb.) nem szivárognak be.
- **Egy helyi folyamat szolgál ki mindent.** A tálca-app saját maga hostol egy helyi szervert, ami
  egyszerre adja a TODO-adatok REST API-ját (a saját UI-nak) és az MCP-végpontot (a `claude.exe`
  agentnek) — nincs külön alrendszer a kettőre.

## Hatókör — v1

**Benne van:**
- Tálca-app (.NET, WPF/WinForms + `NotifyIcon`), ami egy workspace-hez kötött agentet indít,
  felügyel és egy chat-ablakot biztosít hozzá.
- Egy saját helyi szerver: TODO-store (SQLite) + REST API a UI-nak + `/mcp` végpont az agentnek.
- Egy konfigurált agent: a TODO-menedzser (levelezés/Teams triázs + lista-karbantartás).
- Ütemezett, néma triázs-futás + ad-hoc chat ugyanarra a store-ra.

**Nincs benne (későbbre marad):**
- Több workspace/agent egyidejű kezelése (az architektúra ezt nem zárja ki, de a v1 egy agentre
  fókuszál).
- Windows-bejelentkezéskori automatikus indítás (autostart) — ez egy későbbi kényelmi lépés.
- Session-perzisztálás/resume újraindítás után (lásd *Nyitott kérdések*).
- Bármilyen automatikus email-/üzenetküldés — ez tartós, nem "v1" korlátozás, hanem alapelv.

## Architektúra

```
 ClaudeBot (tálca-app, .NET/WPF)
  │
  ├─ Tray ikon + kontextusmenü (agentenként: Megnyitás / Leállítás / Log)
  │
  ├─ Helyi szerver (egy process, egy porton)
  │    ├─ /api/*   REST API a TODO UI-nak (lista/board nézet, CRUD)
  │    ├─ /mcp     MCP végpont a claude.exe agentnek (lásd Tool-felszín)
  │    └─ SQLite   TODO-store (egyetlen fájl)
  │
  ├─ Chat-ablak (WPF, agentenként egy)
  │    - beszélgetés-nézet (streamelt assistant-szöveg)
  │    - beviteli mező → AgentProcessHost.SendPrompt()
  │
  └─ AgentProcessHost (agentenként egy példány)
       - claude.exe subprocess indítása, élve tartása
       - stdin: JSON-sorok írása (user üzenetek)
       - stdout: JSON-sorok olvasása (assistant/result események), esemény továbbítása a UI-nak
       - crash-figyelés, újraindítás, graceful shutdown
```

### Komponensek

| Komponens | Felelősség |
|---|---|
| **`AgentProcessHost`** | Egy `claude.exe` subprocess élethossza: indítás a workspace-mappában, `SendPrompt(text)`, kimeneti JSON-sorok parse-olása és eseményként továbbítása, crash-restart, graceful shutdown (stdin lezárása → timeout → kill). |
| **`WorkspaceConfig`** | Egy agent statikus konfigurációja: munkaterület-mappa, megjelenítendő név, indítási paraméterek. |
| **`TrayController`** | Tálcaikon + menü, a konfigurált agentek `AgentProcessHost`-példányainak felügyelete. |
| **Helyi szerver** | Egyetlen folyamat, két felszínnel: `/api/*` (REST, a saját UI-nak) és `/mcp` (az agentnek). Mindkettő ugyanazt a `TodoStore`-t éri el — nincs duplikált üzleti logika. |
| **TODO-store** | SQLite, egyetlen fájl. Séma: ld. lent. |
| **Chat-ablak** | WPF, a streamelt `assistant`/`result` eseményeket emberi olvasható formában jeleníti meg, beviteli mezővel. |

## Agent-indítás — validált parancs

Élesben leteszteltük, a következő kombináció működik:

```
claude.exe --agent <agent-név> -p
  --input-format stream-json --output-format stream-json
  --permission-mode acceptEdits
  --no-session-persistence
  --strict-mcp-config --mcp-config '{"mcpServers":{"claudebot-tools":{"type":"http","url":"http://127.0.0.1:<port>/mcp"}}}'
```
(`WorkingDirectory` = a workspace-mappa; `CreateNoWindow = true` a `ProcessStartInfo`-n.)

- **Bemenet** (stdin, soronként egy JSON):
  ```json
  {"uuid":"<friss guid>","session_id":"","type":"user","parent_tool_use_id":null,"message":{"content":"<szöveg>","role":"user"}}
  ```
- **Kimenet** (stdout, soronként egy JSON event): `command_lifecycle` (queued/started/completed),
  `system`/`init` (session-metaadat, köztük a csatlakozott MCP-szerverek), `assistant` (a tényleges
  válaszszöveg), `result` (kör vége: végeredmény, `total_cost_usd`, `num_turns`).
- A folyamat **több egymást követő stdin-sor között is megőrzi a kontextust** — nem indul újra
  üzenetenként (élesben tesztelve: két egymást követő promptra helyesen számolt tovább).
- `--permission-mode acceptEdits` szükséges, mert nincs interaktív jóváhagyási csatorna.

## Tool-felszín (MCP, `/mcp`)

A meglévő `Agent-HQ` (todo-mcp) tooljaihoz hasonló alakban, de **kétirányú** szemantikával (az agent
maga is zárhat/módosíthat tételt, nem csak jelezhet):

| Tool | Célja |
|---|---|
| `list_todos(status?)` | Jelenlegi lista lekérdezése, duplikáció elkerülésére triázs előtt. |
| `add_todo(title, description?, category?)` | Új tétel felvétele (pl. `category: "válaszra vár"` a meg nem válaszolt üzenetekhez). |
| `update_todo(id, title?, description?, status?)` | Meglévő tétel módosítása vagy lezárása — **az agent ezt is megteheti**, ellentétben a todo-mcp-vel. |
| `search_todos(query)` | Szövegkeresés cím/leírás alapján. |

*(A pontos séma és paraméterezés a tényleges implementáció előtt finomítandó — ez egy kiindulási
javaslat.)*

## TODO adatmodell — kiindulási javaslat

| Mező | Megjegyzés |
|---|---|
| `id` | |
| `title` | |
| `description` | opcionális, markdown |
| `status` | `open` / `done` (nincs `in_progress` megkülönböztetés, hacsak nem merül fel igény rá) |
| `category` | pl. `"válaszra vár"`, `"javaslat"`, `"emlékeztető"` — szabadon bővíthető |
| `source_link` | hivatkozás az eredeti e-mailre/Teams-üzenetre, ha van |
| `created_by` | `user` / `agent` — ki vette fel |
| `created_at`, `updated_at` | |

*(Nyitott: pontos kategória-készlet, kell-e prioritás mező, kell-e "utoljára látott email-időbélyeg"
a triázs-bookmarkhoz — ez utóbbi valószínűleg igen, külön `settings`-szerű táblában, a todo-mcp
mintájára.)*

## Biztonsági korlátok

- Headless futás = nincs ember, aki egy veszélyes tool-hívást jóváhagyjon. A folyamat-szintű
  `--allowedTools`/`--disallowedTools` paraméterekkel előre le kell zárni, mire van/nincs szüksége
  a TODO-agentnek (pl. nincs szüksége `Bash`-re).
- **Soha nem küld el semmit automatikusan** — ha a jövőben draft-készítés is a scope-ba kerül
  (Outlook-piszkozat, ahogy a mai Asszisztensnél), az is csak piszkozat marad, a küldés emberi
  döntés.
- A helyi szerver kizárólag `127.0.0.1`-re bindol, autentikáció nélkül (egygépes, egyfelhasználós
  eszköz — ugyanaz a bizalmi modell, mint a todo-mcp-nél).

## Életciklus-kezelés

- Indításkor: subprocess létrehozása a workspace-mappában, `CreateNoWindow = true`.
- Normál működés: `AgentProcessHost` a stdin-re ír (felhasználói prompt vagy ütemezett triázs-jel),
  a stdout-ot olvassa, eseményeket küld a UI-nak.
- Hiba esetén: crash-figyelés, automatikus újraindítás.
- Leállításkor: stdin lezárása (hagyja, hogy a folyamat lezárja magát), timeout után `Kill()`.
- **Session-frissesség:** a triázs-futásokat érdemes időről időre friss session-ként indítani, nem
  egyetlen, hetekig élő beszélgetésként — a kontextus-gyorsítótár mérete (és költsége) kör-ről
  körre nő, ezt élesben is mértük.

## Elvetett alternatívák

Ezeket a beszélgetés során megvizsgáltuk és elvetettük — ne kerüljenek elő újra indoklás nélkül:

| Alternatíva | Miért vetettük el |
|---|---|
| **Cloud routine** (`RemoteTrigger`/`schedule` skill) | A felhős futtatás nem éri el a helyi jóváhagyó appot/helyi szolgáltatásokat; a GitHub-hozzáférés sem volt garantált. |
| **Windows Task Scheduler + rejtett ablak (VBS/`--background`)** | Működne, de a felhasználó inkább egy natív, mindig futó felügyelő alkalmazást szeretne, nem egy időzített, egyszeri indítást. |
| **Claude Code natív `--bg` + `claude attach`** | Natívan megoldja a "háttérben fut, később terminálból elérem" igényt (virtuális terminál/pty-alapú session), **de** nem ad strukturált eseményt egy saját grafikus UI-hoz — csak nyers ANSI-puffert. A cél egy teljesen saját chat-felület, ezért ezt elvetettük a DIY stream-json megoldás javára. |
| **A meglévő `Agent-HQ` (todo-mcp) újrahasznosítása** | Explicit, dokumentált tervezési elve: *"no agent ever has a reason to wait or poll"* — egyirányú, humán-döntési queue kódoló agenteknek, nincs agent-kezdeményezte push. Ez az ellentéte a ClaudeBot igényének (agent maga vezeti/frissíti a listát). Csak a szerver-/tálca-/SQLite-architektúra mintája hasznosítható belőle, a szemantika nem. |
| **Belső API MCP nélkül (pl. Bash+curl)** | A Claude Code tool-hívási modelljében nincs könnyebb beépített mechanizmus egyedi app-funkció hívására, mint az MCP — a shell-out alternatíva szélesebb (és headless agentnél kockázatosabb) tool-felszínt igényelne, séma-validáció nélkül. |

## Nyitott kérdések

- Kell-e session-perzisztálás (resume-olhatóság) újraindítás után, vagy minden indítás friss legyen?
- Pontos ütemezési gyakoriság a néma triázsra (konfigurálható legyen-e?).
- TODO-kategóriák végleges listája, kell-e prioritás mező.
- Autostart Windows-bejelentkezéskor — mikor kerüljön be.
- Értesítés/UX: hogyan jelezze a tálcaikon, hogy új javaslat/emlékeztető van.
