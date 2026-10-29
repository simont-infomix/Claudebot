---
id: decision-03
title: "ADR-0003 — Az ablak bezárása a tálcára rejt, az automatikus indítás kapcsolható"
type: adr
version: 0.1.0
created: 2026-10-29
updated: 2026-10-29
references:
  - decision-02
  - decision-01
  - uc-013
  - architecture-c3-winforms-host
---

1. **ADR-0003: Az ablak bezárása a tálcára rejt, az automatikus indítás kapcsolható**

2. **Metadata:**
   - **Status:** Accepted
   - **Date:** 2026-10-29
   - **Deciders:** Simon Tamás
   - **Scope:** backend (WinForms host), üzemeltetés

3. **Context:** Az ADR-0002 két döntést hozott, amelyeket a működő motor birtokában felül kellett
   vizsgálni. Egyrészt az ablak X gombja leállította az alkalmazást — ami egy olyan eszköznél,
   amelynek fő funkciója a háttérben futó ütemezett feladatok végrehajtása (UC-013, ADR-0001),
   azt jelenti, hogy egy reflexből becsukott ablak némán leállítja az összes automatizmust.
   Az ADR-0002 ezt tudatosan halasztotta el, mert a fejlesztés alatt a futó példány zárolja az
   exe-t, így a „bezárásra csak minimalizál" viselkedés nehezítette volna a build-ciklust; a
   tálcaikon és a motor azóta elkészült, a halasztás indoka megszűnt. Másrészt az automatikus
   indítás kapcsoló nélkül, kötelezően be volt kapcsolva — a felhasználó a felületről nem tudta
   befolyásolni, csak a regisztrációs adatbázisból vagy a Feladatkezelőből.

4. **Decision:** Az ablak **X gombja nem lép ki, hanem a tálcára rejti** az alkalmazást; a
   folyamat és vele az ütemező tovább fut. Tényleges kilépés a tálcaikon **„Bezárás"**
   menüpontjával történik. A Windows leállítását/kijelentkezést nem fogjuk el (más
   `CloseReason`), és ilyenkor a mentetlen beállításokra sem kérdezünk rá — nem blokkoljuk a
   rendszer leállását egy kérdéssel.

   Az automatikus indítás **kapcsolhatóvá válik** a tálcaikon menüjéből („Indítás a
   Windows-szal", pipás menüpont). Hogy az ADR-0002 biztonsági szándéka ne vesszen el, **első
   indításkor egyszer magától bekapcsol**, és ezt egy külön jelölő értékkel megjegyezzük
   (`HKCU\Software\ClaudeBot\AutostartInitialized`). Enélkül nem lenne megkülönböztethető a „még
   sosem volt beállítva" és a „a felhasználó szándékosan kikapcsolta" állapot, és minden
   indításkor visszakapcsolnánk, amit a felhasználó kikapcsolt.

   A menüpont állapotát minden megnyitáskor a regisztrációs adatbázis tényleges tartalmából
   olvassuk, nem gyorsítótárazott értékből. Induláskor a bejegyzett útvonalat az aktuális
   exe-útvonalra frissítjük, ha az automatikus indítás be van kapcsolva.

5. **Alternatives considered:**

   **A) Marad az ADR-0002 szerinti állapot (X = kilépés, kötelező autostart)**
   - **For:** nincs új kód; a kilépés útja egyértelmű, nem lehet „véletlenül" futva hagyni az appot.
   - **Against:** egy reflexből becsukott ablak leállítja az összes ütemezett feladatot, és erről
     a felhasználó semmilyen visszajelzést nem kap — pont az eszköz fő funkciója hal el némán.
   - **Why not chosen:** a felhasználói elvárás egy háttérben dolgozó eszköznél az, hogy az X
     nem öli meg; a kötelező autostart pedig a felhasználó gépén hoz döntést helyette.

   **B) X-re felugró kérdés: „bezárás vagy tálcára rejtés?"**
   - **For:** semmi nem történik meglepetésszerűen; a felhasználó dönt esetről esetre.
   - **Against:** minden egyes bezárásnál egy fölösleges kattintás; a tálcaikon megléte mellett a
     kérdés amúgy is eldöntött — a kilépésnek van saját, explicit útja.
   - **Why not chosen:** ismétlődő, érdemi döntést nem hordozó kérdés, ami hamar bosszantóvá válik.

   **C) Kapcsoló nélküli autostart, de a felületen jelezve, hogy be van kapcsolva**
   - **For:** átlátható marad, és nem lehet véletlenül kikapcsolni az ütemezés alapfeltételét.
   - **Against:** a felhasználó látja, de nem teheti meg — a saját gépén nem rendelkezhet arról,
     mi induljon a bejelentkezésével.
   - **Why not chosen:** a láthatóság önmagában nem pótolja a kontrollt; a kezdeti bekapcsolás
     megtartásával a biztonsági szándék kapcsoló mellett is érvényesül.

6. **Consequences:**

   **Positive:** az ütemezett feladatok nem állnak le egy ablak-bezárástól; a kilépésnek egyetlen,
   egyértelmű útja van; a felhasználó rendelkezhet az automatikus indításról, miközben az
   alapértelmezés továbbra is a működő állapot.

   **Negative / accepted cost:** az alkalmazás futva maradhat anélkül, hogy látható ablaka lenne —
   aki nem tudja, hogy a tálcán keresendő, azt hiheti, bezárta; a fejlesztés alatt egy build előtt
   a futó példányt külön le kell állítani (tálcamenü vagy folyamat-leállítás), mert zárolja az
   exe-t; a tálcaikonra rejtés után a Windows leállítása mentetlen beállítás-piszkozatot eldobhat
   kérdés nélkül.

   **Neutral, but worth knowing:** a jelölő érték külön kulcsban (`HKCU\Software\ClaudeBot`) él,
   nem a `Run` kulcsban — a `Run` érték törlése ezért nem „felejti el" a kezdeti beállítást, és
   nem kapcsolja vissza az autostartot. Az útvonal továbbra is a build-kimenetre mutat, amíg nincs
   telepítő; ezt induláskor automatikusan frissítjük, de csak akkor, ha az app egyszer elindult az
   új helyről.

7. **Action items:**
   - [x] Az X gomb a tálcára rejt; kilépés a tálcaikon „Bezárás" menüpontjából.
   - [x] „Indítás a Windows-szal" pipás menüpont, a tényleges regisztrációs állapot alapján.
   - [x] Egyszeri kezdeti bekapcsolás jelölő értékkel, hogy a kikapcsolás tartós maradjon.
   - [x] A bejegyzett exe-útvonal frissítése induláskor.

8. **References:** `ClaudeBotApp/Form1.cs`, `ClaudeBotApp/Form1.Designer.cs`,
   `ClaudeBotApp/WindowsAutostart.cs`, ADR-0002 (felülírva), ADR-0001.
