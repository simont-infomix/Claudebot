---
id: decision-02
title: "ADR-0002 — Az alkalmazás alapértelmezetten a Windowsszal indul, tálcaikonnal"
type: adr
version: 0.2.0
created: 2026-10-28
updated: 2026-10-29
references:
  - decision-01
  - uc-013
  - architecture-c3-winforms-host
---

1. **ADR-0002: Az alkalmazás alapértelmezetten a Windowsszal indul, tálcaikonnal**

2. **Metadata:**
   - **Status:** Superseded by ADR-0003
   - **Date:** 2026-10-28
   - **Deciders:** Simon Tamás
   - **Scope:** backend (WinForms host), telepítés/üzemeltetés

3. **Context:** Az ütemezett feladatok kizárólag futó alkalmazás mellett indulnak el (UC-013,
   ADR-0001) — ha az app nem fut, a feladat nem fut le. Egy visszatérő feladatokat végző
   automatizáló eszköznél ezért az app jelenléte nem a felhasználó napi döntése kell legyen.
   Jelenlegi állapot: a `Program.cs` egyetlen `Application.Run(new Form1())` hívással indít egy
   1000×700-as ablakot; nincs tálcaikon (`NotifyIcon`), és nincs automatikus indítás. A
   `specification.md` eredeti elképzelése tálcaikonos háttér-alkalmazás volt, ez azonban nem
   valósult meg.

4. **Decision:** Az alkalmazás **alapértelmezetten, kapcsoló nélkül** regisztrálja magát a
   Windows bejelentkezéskori indításra a `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
   kulcs alá (nem igényel rendszergazdai jogot). Nem lesz „Indulás Windowsszal" beállítás: az
   automatikus indulás az eszköz működésének előfeltétele, nem opció.

   Az app **ablakos módban indul**, nem minimalizáltan — a bejelentkezés után látható ablakkal
   jelzi, hogy fut. Kap egy **tálcaikont**, amelynek jobbklikk-menüjében egy **„Bezárás"**
   menüpont található; ez az app tényleges leállításának útja.

   A bezárás gomb viselkedése **egyelőre változatlan marad** (az ablak bezárása leállítja az
   appot), mert a fejlesztés alatt a „bezárásra csak minimalizál" viselkedés akadályozná a
   build-ciklust.

5. **Alternatives considered:**

   **A) Kapcsolható automatikus indítás (beállítás a felületen)**
   - **For:** a felhasználó kontrollálja, hogy mi indul a gépével; kevésbé tolakodó.
   - **Against:** nincs app-szintű beállítás-felület (csak bot-szintű), tehát előbb azt is meg
     kellene építeni; ha a felhasználó kikapcsolja, az ütemezett feladatok némán nem futnak le —
     ami pont az eszköz fő funkciója.
   - **Why not chosen:** az automatikus indulás az ütemezett működés előfeltétele; kapcsolóként
     felkínálni azt sugallná, hogy elhagyható.

   **B) Indítás a Startup mappába tett parancsikonnal**
   - **For:** regisztrációs adatbázis érintése nélkül működik, a felhasználó látja és törölheti.
   - **Against:** a parancsikon elérési utat rögzít, ami a build-mappa változásakor elromlik; a
     létrehozás/karbantartás fájlrendszer-műveletekkel jár.
   - **Why not chosen:** a `Run` kulcs ugyanazt adja egyszerűbb, programból megbízhatóan
     frissíthető formában.

   **C) Windows-szolgáltatásként futtatás**
   - **For:** felhasználói bejelentkezéstől függetlenül fut, a leginkább „mindig elérhető".
   - **Against:** szolgáltatásból nem jeleníthető meg felhasználói felület; a `claude.exe`
     felhasználói környezetet és bejelentkezett munkamenetet igényel; telepítés rendszergazdai
     joggal.
   - **Why not chosen:** az app lényege egy interaktív, csevegő felület — ezt szolgáltatásként
     nem lehet kiszolgálni.

6. **Consequences:**

   **Positive:** az ütemezett feladatok a gép bekapcsolása után emberi közreműködés nélkül
   elindulnak; a tálcaikon ad egy egyértelmű, ablaktól független leállítási pontot.

   **Negative / accepted cost:** minden bejelentkezéskor megjelenik egy alkalmazásablak, ami
   zavaró lehet; a felhasználó a felületről nem tudja kikapcsolni az automatikus indulást, csak a
   regisztrációs adatbázisból vagy a Windows feladatkezelőjének indítópult-lapjáról; a feladatok
   továbbra sem futnak, amíg a gép ki van kapcsolva (ezt ADR-0001 pótlási szabálya enyhíti, nem
   szünteti meg).

   **Neutral, but worth knowing:** a `Run` kulcsba írt elérési út a build kimenetére mutat —
   amíg nincs telepítő, egy mappaáthelyezés elrontja az automatikus indulást, és újraregisztrálás
   kell.

7. **Action items:**
   - [ ] `NotifyIcon` felvétele, jobbklikk-menüvel és benne a „Bezárás" menüponttal.
   - [ ] Automatikus indítás regisztrálása induláskor a `Run` kulcs alá, az aktuális exe-útvonallal.
   - [ ] **TODO (későbbre halasztva):** az ablak bezárása ne állítsa le az appot, csak
         minimalizálja a tálcára. Szándékosan nem most készül el, mert a fejlesztés alatti
         build-ciklust (futó példány zárolja az exe-t) megnehezítené.

8. **References:** `ClaudeBotApp/Program.cs`, `ClaudeBotApp/Form1.cs`,
   `ClaudeBotApp/Form1.Designer.cs`, `ClaudeBot/specification.md`, ADR-0001.
