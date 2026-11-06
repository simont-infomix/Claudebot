# Changelog

A ClaudeBot kiadásainak változásai. A verziószámozás a [semantic versioning](https://semver.org/lang/hu/)
elveit követi.

## [1.1.0] — 2026-11-06

### Újdonságok

**A botok fájlokat is küldhetnek egymásnak.** A bot-csatorna `send_message` eszköze opcionális
`files` paramétert kapott: a küldő a saját munkamappájához képest nevezi meg a fájlokat, a program
pedig átmásolja őket a címzett munkamappájába, és a kézbesített üzenethez csatolja. Így egy
delegált feladathoz tartozó munkaanyagot (jelentés, terv, adatfájl) nem kell kézzel átmásolni a két
bot mappája között. A másolat a címzettnél küldőnkénti mappába kerül (`_bejovo/<küldő>/`), hogy egy
azonos nevű fájl ne írhassa felül a saját munkáját. Egy üzenethez legfeljebb 5 fájl mehet,
egyenként legfeljebb 10 MB.

**A botok látják és alakíthatják a saját ütemezett feladataikat.** Három új eszköz: a `list_tasks`
megmutatja a bot rendszeres feladatait, azok ütemezését és a legutóbbi futásuk eredményét, az
`add_task` és az `update_task` pedig felvesz, illetve módosít egyet. Így a „mostantól minden reggel
nézd meg a…" típusú kérés ott teljesül, ahol elhangzik — a beszélgetésben —, nem kell átváltani a
Feladatok fülre és kézzel kitölteni az ütemezést.

Az olvasás szabad, az **írás viszont jóváhagyás-köteles**: amikor a bot feladatot venne fel vagy
módosítana, a megszokott jóváhagyási kártya jelenik meg a csevegésben. Törölni a bot nem tud
feladatot — a legerősebb művelet a szüneteltetés, ami a felületen látszik és egy kattintással
visszavonható. Minden változásról bekerül egy sor a csevegésbe, így tartós engedély megadása után
sem alakulhat át némán az ütemezés.

**Kattintható webcímek és fájlhivatkozások a csevegésben.** Ha egy üzenet webcímet vagy fájlra
mutató hivatkozást tartalmaz, az mostantól kattintható: a webcím a böngészőben, a fájl az
alapértelmezett alkalmazásban nyílik meg. A csatolt fájlok neve is kattintható. A felismerés
szándékosan óvatos — verziószámok, rövidítések és eszköznevek nem válnak hivatkozássá.

Biztonsági okból csak `http`/`https` címek nyílnak meg, és futtatható fájl (`.exe`, `.bat`, `.ps1`,
…) **nem indul el**, hanem az Intézőben jelenik meg kijelölve.

**Érthetőbb Permission mode választó a bot beállításaiban.** A legördülő eddig a parancssori
kapcsoló nyers értékeit sorolta fel; mostantól a terminálablakkal azonos sorrendben és
elnevezéssel jelennek meg a módok, mindegyik alatt magyar nyelvű magyarázattal. A `dontAsk` és a
`bypass permissions` mód mellett figyelmeztetés jelzi, hogy az interaktív jóváhagyás ilyenkor nem
érvényesül az eszközhívásokra.

### Javítások

**Nem indul többé két példány.** Mivel az ablak X gombja a tálcára rejt, könnyű volt észrevétlenül
újraindítani a programot — a két példány ugyanazt a bot-mappát kezelte, és az ütemezett feladatok
duplán futhattak. Az új indítás mostantól a már futó példány ablakát hozza elő a tálcáról. A Debug
és a telepített változat továbbra is futhat egyszerre, egymástól függetlenül.

**A mentetlen beállítások nem vesznek el botváltáskor.** Eddig csak a Settings lap × gombja
kérdezett rá a mentetlen módosításra; ha a felhasználó a sidebarban másik botra kattintott, a
piszkozat figyelmeztetés nélkül elveszett. Mostantól a botváltás — és a jobbklikk menü
„Beállítások", illetve „Feladatok" pontja — is rákérdez.

**A nyers kommunikációs napló nem íródik a telepített változatban.** A `claudebot-stream.log`
eddig minden build-konfigurációban keletkezett; élesben korlátlanul nőtt, és a teljes forgalmat —
benne a prompt-szövegekkel — kiírta a lemezre. Mostantól kizárólag fejlesztői (Debug) változatban
jön létre.

---

## [1.0.0] — 2026-11-05

Első kiadás. A ClaudeBot funkcióinak áttekintése a [README](README.md)-ben olvasható.
