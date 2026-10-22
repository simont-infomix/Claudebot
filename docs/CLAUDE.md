# CLAUDE.md — docs/ dokumentációs rendszer

Ez a fájl rögzíti a `docs/` alatt élő, strukturált specifikációs dokumentumok közös szabályait. A
`.claude/skills/` alatti tartalomgeneráló skillek (`usecase`, `ArchitectureC1`/`ArchitectureC2`/
`ArchitectureC3`, `ServiceDefinition`, `TechRequirements`, `NavigationSchema`, `DesignGuide`,
`ScreenPrototype`, `data-schema`, `adr`, ...) kizárólag szöveget állítanak elő — a fájlba mentés, az
elhelyezés és az `Index.md` karbantartása mindig a hívó (ember vagy ügynök) felelőssége, ezt a fájlt
követve.

Az informális kezdeti vázlat (jelen projektben: `ClaudeBot/specification.md`) nem tartozik ebbe a
rendszerbe — nincs frontmatter-je, nincs `id`-ja, nem hivatkozható a `references` mezőből. A belőle
levezetett formális dokumentumok egyszerűen tartalomként veszik át a releváns részeket, hivatkozás
nélkül.

## Közös frontmatter

Minden `docs/` alatti Markdown dokumentum ezzel a YAML frontmatterrel kezdődik:

```yaml
---
id: <doksi-azonosító>
title: "<megjelenítendő cím>"
type: <doksi-típus>
version: <semver, pl. 0.1.0>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
references: [<más doksik id-jai, vagy üres lista>]
---
```

- **`id`** — kisbetűs, az adott dokumentumtípus konvenciója szerint (ld. lent).
- **`version`** — új dokumentumnál `0.1.0`; revíziónál bump (patch/minor a változás súlyától függően), sosem reset.
- **`created`** — csak az első létrehozáskor kerül be; revíziónál változatlan marad.
- **`updated`** — minden revíziónál frissül a mai dátumra.
- **`references`** — csak ténylegesen felhasznált más dokumentum/döntés `id`-ja kerülhet bele. Sosem kitalált hivatkozás.

## Lazán csatolt dokumentumok

Egy dokumentum *soha* nem ismétli meg szó szerint/parafrazálva egy másik dokumentum tartalmát. Ha egy
inputot egy másik, már létező `docs/` dokumentumból vesz át, azt a frontmatter `references` mezőjében
jelöli (a másik dokumentum `id`-jával) — a törzsben legfeljebb a tényre hivatkozik (pl. "a
TodoStore ..."), sosem "ld. X dokumentum" formában.

## Egy- és többpéldányos dokumentum-típusok

Néhány típusból pontosan egy példány létezik a projektben (pl. `architecture-c1`,
`ui-design-guideline`, `navigation-schema`, `data-schema`, `tech-requirements`) — ezeknél az `id` és a
`type` mindig ugyanaz a rögzített literál, és egy új futtatás a meglévő dokumentum revíziója, nem egy
új dokumentum.

Másoknál több példány is létezhet (pl. `use-case`, `architecture-c2`, `architecture-c3`,
`service-definition`, `screen-prototype`) — ezeknél az `id` tartalmazza a megkülönböztető részt is:
sorszám (`uc-001`, `uc-002`, ...) vagy **slug** (ASCII, kisbetűs, kötőjeles alak az entitás/rendszer/
konténer/service/képernyő nevéből, pl. `TodoStore` → `todo-store`).

## Könyvtárszerkezet

| Típus (`type`) | Példány | Elérési út |
|---|---|---|
| `use-case` | több | `docs/use-cases/<id>-<slug>.md` (a slug a use case nevéből, ASCII, kisbetűs, kötőjeles) |
| `architecture-c1` | egy | `docs/architecture-c1.md` |
| `architecture-c2` | több, rendszerenként | `docs/architecture-c2/<system-slug>.md` |
| `architecture-c3` | több, konténerenként | `docs/architecture-c3/<container-slug>.md` |
| `ui-design-guideline` | egy | `docs/ui-design-guideline.md` |
| `navigation-schema` | egy | `docs/navigation-schema.md` |
| `screen-prototype` | több, képernyőnként | `docs/prototypes/<screen-slug>.html` |
| `data-schema` | egy | `docs/data-schema.md` |
| `service-definition` | több, service-enként | `docs/services/<service-slug>.md` |
| `tech-requirements` | egy | `docs/tech-requirements.md` |
| döntés (ADR) | több | `docs/adr/<NNNN>-<slug>.md`, összesítve: `docs/Decision_list.md` |

*(A `feature`/`user-story`/`milestone` tartalom-skillek egyelőre nem kötelezik el magukat egy
elérési út mellett ebben a projektben — ha ezek előkerülnek, ezt a táblázatot bővíteni kell.)*

## Index.md

A `docs/Index.md` a teljes dokumentumkészlet gyors áttekintése és a következő szabad sorszám
megállapításának helye — minden új dokumentum létrehozásakor ide is felkerül egy sor (`id | Cím |
Típus | Útvonal`). Új `UC-`/`REQ-`/`ADR-` szám kiosztása előtt mindig ezt (és a releváns almappát)
kell ellenőrizni, ütközés elkerülésére.

## Döntések

Egy jelentős, nehezen visszafordítható technikai döntés az `adr` skillel készül, `decision-NN`
azonosítóval (`ADR-0001`, `ADR-0002`, ...), `docs/adr/<NNNN>-<slug>.md` alatt. A döntések futó
összesítése a `docs/Decision_list.md`-ben élne — ez még nem jött létre, az első döntés
rögzítésekor kell megnyitni.
