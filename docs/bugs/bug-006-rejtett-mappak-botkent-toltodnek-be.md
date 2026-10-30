---
id: bug-006
title: "BUG-006 — A Bots/ mappa minden alkönyvtárát (rejtett mappát is) botnak tölti be"
type: bug
version: 0.2.0
created: 2026-10-30
updated: 2026-10-30
references:
  - uc-019
---

> **Állapot: javítva (2026-10-30).** A megoldást lásd a dokumentum végén.

## Összefoglalás

A `BotSessionManager.LoadExisting()` a `Bots/` gyökér **minden** alkönyvtárát botként tölti be,
szűrés nélkül — beleértve egy esetlegesen ott keletkező `.claude` mappát is (amit maga a
`claude.exe` hoz létre projekt-szintű beállításként, ha valaki a `Bots/` mappában magában indít
egy CLI-munkamenetet). Ennek hatására egy teljesen értelmetlen, `.claude` nevű "bot" jön létre:
nincs `.bot-meta.json`-ja, nincs model/effort/allowedTools beállítása, mégis elindul neki egy
önálló `claude.exe` folyamat.

Megfigyelve élesben (Release build): a `Bots/` mappában 4 valódi bot (Assistens, Hermes,
Librarian, Scrum Master) mellett volt egy `.claude` almappa is — ez egy ötödik, érvénytelen
`claude.exe` gyermekfolyamatot eredményezett (`--allowedTools mcp__*`-on kívül semmilyen egyedi
beállítás nélkül).

## Reprodukálás

1. Nyiss egy terminált közvetlenül a `Bots/` mappában (nem egy bot almappájában), és indíts el
   benne egy `claude` munkamenetet — ez létrehoz egy `Bots/.claude/` mappát.
2. Indítsd újra a ClaudeBotApp-ot.
3. **Eredmény:** a sidebarban megjelenik egy ".claude" nevű, érvénytelen "bot", és elindul
   neki egy saját `claude.exe` folyamat is.

## Valószínű kiváltó ok

`ClaudeBotApp/BotSessionManager.cs` — `LoadExisting()`:

```csharp
public void LoadExisting()
{
    Directory.CreateDirectory(_rootDir);

    foreach (var dir in Directory.GetDirectories(_rootDir).OrderBy(d => d))
    {
        AddBot(Path.GetFileName(dir), dir);
    }
}
```

Nincs szűrés sem a `.`-tal kezdődő (rejtett/konfigurációs) mappanevekre, sem arra, hogy a
mappában van-e egyáltalán `.bot-meta.json` vagy bármilyen bot-jellegű tartalom.

## Javaslat

A `LoadExisting()` hagyja ki a `.`-tal kezdődő mappaneveket (`Path.GetFileName(dir).StartsWith(".")`),
hasonlóan ahhoz, ahogy a legtöbb eszköz figyelmen kívül hagyja a rejtett könyvtárakat.

## Megoldás

A `LoadExisting()` mostantól kihagyja a `.`-tal kezdődő mappaneveket.

A `Bots/.claude/` mappa emellett **szándékos, hasznos hellyé** vált: élesben igazolva (két
teszttel, a `system/init` stream-json esemény `skills`/`agents` mezőit vizsgálva), hogy a
`claude.exe` a munkakönyvtárból (egy bot mappájából) felfelé haladva **ténylegesen felveszi** a
szülő `Bots/.claude/skills/` és `Bots/.claude/agents/` tartalmát — ez nem a host valamilyen
saját mechanizmusa, hanem a CLI natív, dokumentálatlan viselkedése. Emiatt a `GetBotDetails` a
"Képességek" fülhöz mostantól ezt a közös mappát is beolvassa, `Shared = true` jelöléssel
(lásd UC-019), a bot saját `.claude/skills`/`.claude/agents` tartalma mellett. A felületen a
"Megosztott (minden bot eléri)" alcím különbözteti meg a bot-specifikus bejegyzésektől.
