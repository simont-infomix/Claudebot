---
id: decision-01
title: "ADR-0001 — Ütemezett feladatok futtatása pollozó időzítővel, a definícióból számolt következő futással"
type: adr
version: 0.1.0
created: 2026-10-28
updated: 2026-10-28
references:
  - uc-010
  - uc-012
  - uc-013
  - uc-014
  - architecture-c3-winforms-host
  - architecture-c3-claude-code-cli-session
---

1. **ADR-0001: Ütemezett feladatok futtatása pollozó időzítővel, a definícióból számolt következő futással**

2. **Metadata:**
   - **Status:** Accepted
   - **Date:** 2026-10-28
   - **Deciders:** Simon Tamás
   - **Scope:** backend (WinForms host), adatmodell

3. **Context:** A ClaudeBot fő funkciója, hogy a botok visszatérő feladatokat végezzenek el emberi
   beavatkozás nélkül (UC-013). A feladat-definíciók tárolása és a felület már elkészült, a
   végrehajtó motor nem. Három ütemezés-típust kell kiszolgálni: *naponta többször* (két futás
   között eltelő óra+perc), *hetente* (kijelölt napok + időpont) és *havonta* (a hónap kijelölt
   napjai + időpont). Az alkalmazás a Windowsszal indul (ld. ADR-0002), tehát a kimaradások fő
   oka a kikapcsolt gép lesz, nem az, hogy a felhasználó nem indította el az appot. Meglévő
   technikai adottságok: botonként egy hosszú életű `claude.exe` folyamat, amivel a
   `BotSession` stream-json soronként kommunikál; a `BotSession.SendPrompt` jelenleg eldobja az
   általa generált prompt-uuid-t, és a kimeneti feldolgozás csak az `assistant` eseményt ismeri.

4. **Decision:** A motor egy **30 másodpercenként ébredő pollozó időzítő** lesz, amely minden
   ébredéskor összehasonlítja a feladatok eltárolt következő futási időpontját az aktuális idővel
   — nem feladatonkénti, precíz egyszeri időzítő. A következő futás időpontját mindig **a
   definícióból** számoljuk ki (`ComputeNextRun(schedule, after)`), nem „utolsó futás +
   intervallum" alapon.

   A „naponta többször" típus réseit **éjféltől indexeljük, napi újraindulással**: 00:00,
   00:00+N, … — ha N nem osztja a 24 órát, a nap utolsó rése rövidebb lesz, ezt elfogadjuk. A
   havi típusnál a hónap hosszánál nagyobb napszámot **a hónap utolsó napjára csonkoljuk**, és a
   csonkolás eredményét **halmazként** kezeljük, hogy a 29/30/31 egyszerre kijelölt napok
   februárban egyetlen futást váltsanak ki, ne hármat.

   Egy futás befejezését a `claude.exe` `result` eseményéből ismerjük fel, a kiváltó prompthoz
   **uuid alapján korrelálva** (a `result` esemény `user_message_uuid` mezője megegyezik a
   `SendPrompt` által küldött `uuid`-val), a kimenetelt az `is_error` mező adja. Ehhez a
   `SendPrompt` visszaadja a generált uuid-t, a `BotSession` pedig új, befejezést jelző eseményt
   kap.

   **Kimaradt futások pótlása:** induláskor és alvásból ébredéskor feladatonként **legfeljebb egy**
   kimaradt futást pótolunk — a legutolsót —, és csak akkor, ha az esedékes időpont **3 óránál nem
   régebbi**.

5. **Alternatives considered:**

   **A) Feladatonkénti precíz időzítő (egyszeri timer a következő futásra)**
   - **For:** másodperc-pontos indítás, nincs felesleges ébredés.
   - **Against:** a gép alvása/ébredése, az óraátállítás és a nyári időszámítás mind külön
     kezelendő eset; az időzítőket minden definíció-változásnál újra kell építeni; egy „elaludt"
     időzítő némán kihagy egy futást.
   - **Why not chosen:** perc-granularitású ütemezéshez a ≤30s késés érdektelen, cserébe a
     pollozás a felsorolt éles eseteket külön kód nélkül, magától helyesen kezeli.

   **B) Windows Task Scheduler használata a saját motor helyett**
   - **For:** az operációs rendszer kezeli az időzítést, a kimaradt futások pótlását is tudja.
   - **Against:** a feladatot a futó `claude.exe` session-be kell injektálni, ami csak az élő
     app-folyamaton belülről lehetséges; külső ütemező csak az app indítására lenne jó, a
     feladat-szintű vezérlésre nem; a feladatok definíciója a bot konfigurációjában él, nem
     az OS-ben — a kettő szinkronban tartása új hibaforrás.
   - **Why not chosen:** a feladat végrehajtása eleve az app-folyamaton belül történik, így a
     külső ütemező csak egy második, redundáns igazságforrást hozna be.

   **C) „Utolsó futás + intervallum" alapú következő-futás-számítás**
   - **For:** triviális implementáció, nem kell naptári logika.
   - **Against:** a futások pici késései összeadódnak (csúszás); újraindítás után az utolsó futás
     ismerete nélkül nincs kiindulópont; a nyári/téli időszámítás váltását külön kellene kezelni.
   - **Why not chosen:** a definícióból számolás állapotmentes, és a DST-váltás magától helyes
     marad, mert mindig a kívánt helyi időpontot keressük meg újra.

6. **Consequences:**

   **Positive:** a motor állapotmentesen újraszámolható, így újraindítás, alvás és óraátállítás
   után is magától helyreáll; a futás kimenetele (sikeres/sikertelen) nem heurisztika, hanem a
   CLI saját `result` eseménye; a 3 órás pótlási korlát megoldja a „reggel 8-as feladat, 9-kor
   bekapcsolt gép" esetet anélkül, hogy egy hét kihagyás után futás-áradatot okozna.

   **Negative / accepted cost:** a futás indítása legfeljebb ~30 másodpercet késhet; a „naponta
   többször" típusnál nem 24-gyel osztható intervallum esetén a nap utolsó rése rövidebb; a 3
   óránál régebbi kimaradt futások véglegesen elvesznek, pótlás nélkül; a `BotSession`-t meg kell
   bontani (uuid visszaadása, `result` feldolgozása), ami érinti a meglévő chat-utat is.

   **Neutral, but worth knowing:** a pollozási ütem (30s) és a pótlási küszöb (3 óra) egyetlen
   konstans — ha később finomhangolás kell, nem jár szerkezeti átalakítással. A feladat-futás a
   bot meglévő, chatben is használt session-jében fut, tehát a kimenete a csevegésben látszik és
   a kontextusba is bekerül.

7. **Action items:**
   - [ ] `ScheduledTask` C# modell átállítása a felületen már kialakított alakra (strukturált
         ütemezés, aktív-jelző, utolsó futás, következő futás).
   - [ ] `ComputeNextRun` implementálása a három típusra, a havi csonkolás-duplikáció kezelésével.
   - [ ] `BotSession.SendPrompt` adja vissza a prompt uuid-ját; a `result` esemény felismerése és
         befejezést jelző esemény kiváltása.
   - [ ] Átfedés-védelem: folyamatban lévő futás alatt az új kör kihagyottként rögzüljön.
   - [ ] A mentés ne felülírja, hanem **azonosító alapján fésülje össze** a definíciós (felületről
         érkező) és a futásidejű (szerver oldali) mezőket — különben egy nyitott Settings lapról
         történő mentés felülírja a közben lefutott feladat friss futási adatát.

8. **References:** `ClaudeBotApp/BotSession.cs`, `ClaudeBotApp/BotSessionManager.cs`,
   `docs/use-cases/uc-013-utemezett-feladat-automatikus-lefutasa.md`, ADR-0002.
