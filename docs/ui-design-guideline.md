---
id: ui-design-guideline
title: UI design szabályzat
type: ui-design-guideline
version: 0.10.0
created: 2026-10-15
updated: 2026-10-29
references:
  - architecture-c3-react-ui
---

## Hangulat

Az Aurora stílus-specifikáció alapján: sötét, kozmikus alapfelület, ambiens aurora-gradiens
fényekkel és rétegzett glassmorphism felületekkel. Letisztult, fejlesztői-eszköz karakter —
prémium, éteri hangulat, a kontraszt és olvashatóság elsőbbségével a drámai hatás felett.

## Színpaletta

| Szerep | Szín | Használat |
|---|---|---|
| Alap háttér (canvas) | `rgba(8,12,20,1)` | A legmélyebb réteg — a teljes alkalmazás háttere. |
| Közép háttér | `rgba(13,18,32,1)` | Sidebar háttere, dialógus-modál alapja. |
| Felület (glass) | `rgba(255,255,255,0.06)` | Avatar-gombok, log-keret, kártyák — frosted glass panel `blur(12px)`-vel. |
| Felület hover | `rgba(255,255,255,0.08)` | Glass felületek hover-állapota. |
| Elsődleges szöveg | `rgba(237,242,255,1)` | Avatar-feliratok, log-szöveg, gombfeliratok. |
| Másodlagos szöveg | `rgba(139,155,187,1)` | Placeholder-szöveg (pl. "Még nincs üzenet"), segédszövegek. |
| Akcentszín (Arctic Teal) | `rgba(0,232,200,1)` | Kiválasztott bot avatar-keretje + glow, fókuszjelzés, elsődleges interaktív kiemelés. |
| Hiba/figyelmeztetés | `rgba(255,83,112,1)` | Validációs hibaüzenetek, rendszerhiba log-sorok, hibás bot-állapot jelölő. |
| Siker/fut állapot (Boreal Green) | `rgba(61,255,154,1)` | "Fut" állapot-jelölő pötty, glow-pulse animációval. |
| Keret/elválasztó | `rgba(255,255,255,0.08)` | Glass felületek hajszálvékony kerete. |

Ambiens háttér-gradiens (a canvas felett, legfeljebb 2 aurora-árnyalattal, soha nem szolid kitöltésként):

```css
background: radial-gradient(ellipse 80% 60% at 20% 20%, rgba(0,232,200,0.10) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 85% 80%, rgba(139,92,246,0.10) 0%, transparent 60%),
            rgba(8,12,20,1);
```

## Tipográfia

- **UI-feliratok, gombok, dialógusok:** `Inter` (fallback: `Manrope, system-ui, sans-serif`) — az Aurora stílus saját tipográfiai alapja, letisztult és kiváló olvashatóságú sötét háttéren.
- **Log-szöveg:** monospace (`JetBrains Mono, Fira Code, monospace`) — a fejlesztői jellegű log-tartalom monospace-ben olvasható jól.
- **Méretskála:** szekció-cím 16px/600 (Heading 3); UI-felirat (gomb, avatar) 13px/400 (Body S); törzsszöveg/log-sor 14px/400 (Body M); placeholder-szöveg 20px/400 (Heading 2 méret, redukált súllyal).

## Térköz-skála

Aurora 4px grid: **4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 96 px** (`--sp-1` … `--sp-24`).
Minden margó/padding ebből a skálából választandó, köztes érték nem megengedett.

## Rács és reszponzivitás

**Elrendezés-alap:** a Sidebar **kívül van** a 12-oszlopos rácson — egy önálló, fix 96px szélességű zóna (`flex-shrink: 0`), nem oszlop-span. 96px a tényleges tartalmából jön (64px-es avatar + 2×16px padding; mindhárom szám — 64, 16, 96 — a Térköz-skála natív tagja), és nem skálázódik az ablakmérettel (egy korábbi verzióban `minmax(96px, 1fr)`-ként a rács része, fluid szélességgel próbálkoztunk — ez feleslegesen bonyolította a CSS-t anélkül, hogy érdemi hasznot hozott volna, mert az avatarok mérete úgyis fix marad, a plusz szélesség csak üres tér lenne).

A Content a rendelkezésre álló teljes maradék szélességet kapja (`flex: 1`), és **saját, önálló 12-oszlopos rácsot** definiál (`grid-template-columns: repeat(12, 1fr)`) — ez már nem a Sidebar-ral közös rács egy subgrid-je, mert nincs többé szülő-rács, amitől örökölne. A belső blokkok (top-bar, log-frame, bottom-bar) mind `grid-column: 1 / -1`-gyel a teljes 12 oszlopot fedik a Content saját rácsában.

**Margó:** mivel a Sidebar önálló zóna (ld. Elrendezés-alap), a margó/gutter nem egy közös, rács-szintű (`.app`) beállítás többé, hanem a `.content` saját, egységes `padding: 16px` (`--sp-4`) értéke — nem kell oldalanként felülbírálni, mert mind a négy oldalon ugyanaz a térköz kell:

- Ez a padding adja egyszerre a **Sidebar–Content gutter-t** (bal oldala), a **jobb oldali rács-margót**, és a **felső/alsó margót** a Content tartalma (top-bar, log-frame, bottom-bar) körül.
- A Sidebar ettől függetlenül, önállóan kezeli a saját megjelenését: nincs rajta margó/padding az `.app`-tól, a teljes ablakmagasságot kitölti (edge-to-edge fent/lent/balra is) — csak a saját belső `padding: 16px`-je (ld. Komponens-konvenciók) ad térközt az avatar-gomboknak.

**Gutter:** a Sidebar avatar-gombjai között 8px (`--sp-2`); a Content terület belső blokkjai (top-bar / log-frame / bottom-bar) között 24px (`--sp-6`, a log-frame saját függőleges margója). A Content saját 12-oszlopos rácsának is van egy 16px-es (`--sp-4`) oszlopközi gutterje, bár ennek ma nincs azonnali vizuális hatása (ld. Elrendezés-alap).

**Töréspontok / viselkedésváltások** (desktop app — az ablak-átméretezés, nem eszköz-kategória határozza meg):

- **Minimum ablakméret: 700px szélesség × 500px magasság.** Ezt a WinForms host kényszeríti ki (`MinimumSize`). A Sidebar fix szélessége (96px) miatt ennél a méretnél is garantáltan elfér az avatar.
- **≥ 1400px szélesség:** a log-szöveg sorai legfeljebb 960px szélességnél törnek újra, még akkor is, ha a Content terület ennél szélesebb. A Sidebar szélessége minden ablakméretnél fix 96px marad; csak a Content szélesedik.
- **Dialógusok:** fix 360px szélesség (Aurora Modal glass szint), középre igazítva — nem skálázódnak az ablakmérettel.

**Lekerekítés (Aurora Border Radius):** `--radius-sm` 6px (állapot-pötty, apró jelölők), `--radius-md` 10px (gombok, input mező), `--radius-lg` 14px (log-keret), `--radius-xl` 20px (dialógus), `--radius-full` 9999px (avatar-körök).

## Komponens-konvenciók

**Lista-kártya / lista-elem (Sidebar avatar):** kör alakú (`--radius-full`), 64×64px, 8px margó a szomszédos elemekhez. Alapállapotban Glass Raised felület (`rgba(255,255,255,0.06)`, `blur(12px)`, 1px `rgba(255,255,255,0.11)` keret); kiválasztott állapotban a keret `rgba(0,232,200,0.40)`-re vált, és glow jelenik meg: `box-shadow: 0 0 0 1px rgba(0,232,200,0.30), 0 0 16px rgba(0,232,200,0.20)`. A felirat a bot neve, középre igazítva, sortörve ha nem fér el egy sorban.

**Dinamikus mező-típusok vizuális konvenciója:**

| Mező-típus | Vizuális konvenció |
|---|---|
| Bot-állapot (fut / leállt / hiba) | 10px átmérőjű pötty az avatar jobb alsó sarkában: `rgba(61,255,154,1)` (Boreal Green) = fut, enyhe glow-pulse animációval (2s ease-in-out infinite, opacity 0.4→0.9); `rgba(139,155,187,1)` = leállt; `rgba(255,83,112,1)` = hiba, glow nélkül, hogy megkülönböztethető legyen a futó állapottól. |
| Olvasatlan bot-üzenet (UC-017) | 10px átmérőjű pötty az avatar jobb **felső** sarkában (a jobb alsó a Bot-állapot pöttyéé, így a kettő nem ütközik): Arctic Teal (`rgba(0,232,200,1)`), enyhe glow-val (`0 0 6px rgba(0,232,200,0.6)`), 1px `rgba(8,12,20,1)` kerettel a kontraszthoz. Statikus, nem pulzál — a futó-állapot glow-pulse-ával egyszerre túl nyugtalan lenne a sidebar. Nincs számláló, csak a tény jelzése. Ugyanez a pötty jelenik meg (a tálcaikon méretéhez illesztve) a tálcaikon jobb felső sarkában is, ha legalább egy botnak van olvasatlan üzenete. |
| Chat-üzenet típusa (user / assistant válasz / rendszerinfo / hiba-stderr) | ld. Chat-buborékok alszekció — ez négy, vizuálisan megkülönböztetett típus, nem csak színezett szövegsor. |

**Chat-buborékok:** a beszélgetés sor-alapú, minden sor egy `chat-row` (igazítás: user → jobbra, assistant/info/error → balra kivéve info/error, ami középre), benne egy `chat-bubble` (max-width 70%, ≥1400px ablaknál abszolút felső korlát 640px):

| Típus | Igazítás | Háttér | Szöveg/keret |
|---|---|---|---|
| `user` (a felhasználó üzenete) | Jobbra | `linear-gradient(135deg, rgba(0,232,200,0.18), rgba(75,159,255,0.18))` | `rgba(237,242,255,1)` szöveg, border `rgba(0,232,200,0.30)` |
| `assistant` (a bot válasza) | Balra | Glass Base (`rgba(255,255,255,0.06)`) | `rgba(237,242,255,1)` szöveg, border `rgba(255,255,255,0.11)` |
| `info` (rendszerjegyzet, pl. "A claude.exe folyamat leállt") | Középre | transparent, border nélkül | `rgba(139,155,187,1)`, dőlt, 13px — nem teljes buborék, csak egy diszkrét sor |
| `error` (hiba/stderr) | Középre | `rgba(255,83,112,0.10)` | `rgba(255,83,112,1)`, border `rgba(255,83,112,0.30)`, a sor elején ⚠ jel |

Mind a négy típus `--font-mono`-t használ (a log-szerű, fejlesztői jellegű tartalom miatt), `--radius-lg` (14px) lekerekítéssel.

**Fix szekciók:**
- *Sidebar* — `rgba(13,18,32,1)` háttér, `backdrop-filter: blur(16px)`; mindig látható, a "+" gomb mindig a lista alján rögzített (Ghost-variáns, ld. Gombok).
- *ChatView* — a chat-keret Glass Base szint (`rgba(255,255,255,0.04)`, 1px `rgba(255,255,255,0.07)` keret, blur nélkül, hogy a hosszú szöveg ne veszítsen kontrasztot); a tetején jobbra igazítva az "Open" gomb (Secondary-variáns) és a beállítások-ikon; alul fix pozícióban a beviteli sáv (ld. Beviteli sáv); automatikus görgetés az utolsó üzenetre, kivéve ha a felhasználó kézzel feljebb görgetett.
- *Üres állapot* — a "Még nincs üzenet" felirat középre igazítva, `rgba(139,155,187,1)` színnel.

**Beviteli sáv (önálló `ChatInput` komponens, bővíthetőség miatt elkülönítve):** Glass Base keret (`rgba(255,255,255,0.04)`, 1px `rgba(255,255,255,0.08)` keret, `--radius-lg`), benne balra egy auto-növő `textarea` (alapértelmezett magasság 56px, max 5 sorig nő — kb. 121px — onnantól saját scrollbar jelenik meg; placeholder és beírt szöveg egyaránt függőlegesen középre igazítva), jobbra, a konténer jobb alsó sarkához rögzítve egy 40×40px küldés-gomb (Primary Button Pattern: teal→kék gradiens + glow, send-ikon), a scrollbar és a gomb között 4px rés. `Enter` küld, `Shift+Enter` új sort — ez a konvenció minden jövőbeli, a beviteli sávba kerülő funkcióra is érvényes marad.

**Csatolmány-sáv (az üzenet-terület és a beviteli mező között):** csak akkor foglal helyet (8px — `--sp-2` — réssel mindkét szomszédja felé), ha az éppen szerkesztett üzenethez legalább egy fájl van csatolva (drag&drop-pal vagy vágólapról, Ctrl+V-vel) — üres állapotban nincs extra térköz. Minden csatolt fájlhoz egy Attachment Chip jelenik meg: Glass felület (`rgba(255,255,255,0.06)`, 1px `rgba(255,255,255,0.11)` keret), `--radius-full` lekerekítés (pill-alak), benne a fájlnév (13px, `--font-ui`, 5 karakter után levágva és `...`-tal jelezve, pl. `valam...`), teljes fájlnévvel `title`-tooltipként, jobb szélén egy 18×18px kerek "✕" törlés-gomb (`rgba(139,155,187,1)` alapszín, hoveren `rgba(255,83,112,0.15)` háttér + `rgba(255,83,112,1)` szöveg — ugyanaz a hiba-szín-logika, mint a validációs hibajelzésnél). A csatolmányok csak a tényleges üzenetküldéskor kerülnek át a bot workspace-ébe; amíg az üzenet nincs elküldve, kizárólag kliensoldali állapot.

**Gombok (Aurora Button Pattern):**

| Variáns | Háttér | Szöveg | Használat |
|---|---|---|---|
| Primary | `linear-gradient(135deg, rgba(0,232,200,1), rgba(75,159,255,1))` + glow (`0 0 0 1px rgba(0,232,200,0.30), 0 0 16px rgba(0,232,200,0.20)`) | `rgba(8,12,20,1)` | "OK" a bot-létrehozó dialógusban. |
| Secondary | `rgba(255,255,255,0.07)`, border `1px solid rgba(255,255,255,0.13)` | `rgba(237,242,255,1)` | "Open", "Mégse". |
| Ghost | transparent, border `1px solid rgba(0,232,200,1)` | `rgba(0,232,200,1)` | "+" új bot gomb, beállítások-ikon. |

Magasság: 40px standard; padding `--sp-4` vízszintes, `--sp-2` függőleges; lekerekítés `--radius-md` (10px).

**Állapot-jelölők:** ld. a Bot-állapot sort a fenti táblázatban. A másik chip-jellegű elem az Attachment Chip (ld. Csatolmány-sáv) — vizuálisan eltérő szerepű (nem állapotjelző, hanem eltávolítható, tooltippel ellátott adat-elem), ezért saját, pill-alakú konvenciót kapott, nem az állapot-pötty mintáját követi.

## Interakciós szabályok

- **Érinthető méret minimum:** 32px minden interaktív elemre (a felület elsődlegesen egér-vezérelt; a kör-avatarok 64px-es mérete bőven efelett van).
- **Átmenetek (Aurora motion):** 150ms micro (hover, fókusz), 220ms standard (panel nyitás/zárás, dialógus), easing `cubic-bezier(0.22, 1, 0.36, 1)` nyitásra, `ease-in-out` állapotváltásra. `prefers-reduced-motion` esetén minden animáció (beleértve a glow-pulse-t) azonnalira degradál.
- **Megerősítés visszavonhatatlan műveleteknél:** jelenleg nincs a tervezett funkciók közt visszavonhatatlan/destruktív művelet (bot létrehozása nem roncsol semmit). Ha a jövőben bekerül a bot-törlés, az kötelezően modális megerősítést igényel majd, Aurora Modal glass szinttel (ld. Rács és reszponzivitás — Dialógusok).
- **Mentési modell:** autosave minden szerkeszthető mezőn, nincs explicit "Mentés" gomb.

## Hibakezelés

- **Beviteli/validációs hiba** (pl. üres vagy érvénytelen bot-név, névütközés): inline hibaszöveg a mező alatt, `rgba(255,83,112,1)` színnel; az input mező kerete `rgba(255,83,112,0.60)`-ra vált, belső glow `0 0 0 3px rgba(255,83,112,0.15)` — nem natív alert/MessageBox, a dialógus nyitva marad, a mező fókuszban.
- **Rendszerszintű hiba** (pl. a `claude.exe` indítása sikertelen): kiemelt, `rgba(255,83,112,1)` színű `error`-buborék a ChatView-ban, és az érintett bot avatarjának állapot-pöttye hiba-színre vált (glow nélkül, hogy megkülönböztethető legyen a "fut" pulzáló glow-tól).
- **Üres állapot:** ld. Komponens-konvenciók — vizuálisan egyértelműen megkülönböztetendő a hibaállapottól (semleges szürkés-kék, nem piros).

## Visszajelzés (Feedback)

- **Mentés-visszajelzés:** autosave mellett egy rövid, 1-2 másodperc után elhalványuló "Mentve" felirat jelenik meg `rgba(61,255,154,1)` színnel a szerkesztett mező mellett.
- **Visszavonhatatlan művelet nyugtázása:** jelenleg nem releváns (ld. Interakciós szabályok).
- **Betöltési állapot:** új bot létrehozásakor, amíg a `claude.exe` session el nem indul, az avatar állapot-pöttye glow-pulse animációt kap (`rgba(0,232,200,1)`, 2s ease-in-out infinite, opacity 0.4→0.9) ahelyett, hogy egyszerűen elhalványodna.
- **Érintési visszajelzés:** minden kattintható elemen `cursor: pointer`; glass felületeken hover a háttér-átlátszóságot `0.06`-ról `0.08`-ra emeli (ld. Színpaletta — Felület hover); a Primary gomb glow-ja hoveren enyhén erősödik.

## Akadálymentesség

- **Minimum kontrasztarány:** WCAG AA, 4.5:1 szöveg/háttér párra body szövegnél, 3:1 nagy címsor-méretnél.
- **Glassmorphism-figyelmeztetés:** minden `backdrop-filter`-t használó felületet (avatar, Sidebar, dialógus) tesztelni kell kontraszt szempontjából — ha a blur mögötti tartalom csökkenti az olvashatóságot 4.5:1 alá, tömör háttérszín-fallback szükséges.
- **Fókuszjelzés:** minden interaktív elemen látható `outline: 2px solid rgba(0,232,200,1); outline-offset: 3px`.
- **Ikon-only elemek címkézése:** a beállítások-ikon (⚙) kapjon `aria-label="Beállítások megnyitása"`-t; az "Open" gombnak van látható felirata, külön címkézés nem szükséges.
