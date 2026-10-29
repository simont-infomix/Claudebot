---
id: uc-010
title: "UC-010 — Ütemezett feladat definiálása egy bot számára"
type: use-case
version: 0.3.0
created: 2026-10-26
updated: 2026-10-28
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
---

1. **Name:** Ütemezett feladat definiálása egy bot számára

2. **Goal / short description:** A felhasználó a fő képernyő "Feladatok" tabján rögzít egy
   visszatérő feladatot (név, ütemezés, az agentnek szánt prompt) a kiválasztott bothoz, hogy a
   bot azt a megadott időzítés szerint, emberi beavatkozás nélkül, ismételten elvégezze.
   - **2.1 Precondition:** Van kiválasztott bot, a felhasználó a "Feladatok" tabon áll.
   - **2.2 Exclusions:** Nem tartalmazza a feladat tényleges lefutását (UC-013), kézi
     futtatását (UC-014), módosítását (UC-011) és szüneteltetését (UC-012).

3. **Actors:** Primary: felhasználó. Secondary: a bot-konfiguráció perzisztenciája.

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó a Feladatok tabon új feladat felvételét kezdeményezi"]
    B --> C["Megadja a feladat nevét és az agentnek szánt promptot"]
    C --> D["Kiválasztja az ütemezés típusát: naponta többször / hetente / havonta"]
    D --> E["Megadja az ütemezés paramétereit (gyakoriság, időpont, napok)"]
    E --> F["Az új feladat megjelenik a feladatlistában, aktív állapotban"]
    F --> G["Felhasználó elmenti a módosítást"]
    G --> H["A feladat-definíció a bot konfigurációjába kerül"]
    H --> I["Az időzítő a következő esedékes futás időpontját kiszámolja a feladathoz"]
    I --> J(["End"])
```

5. **Potential errors:** Üres név vagy üres prompt → a feladat nem vehető fel, a felhasználó
   jelzést kap; hiányosan megadott ütemezés (heti vagy havi típusnál egyetlen nap sincs
   kijelölve) → a feladat nem vehető fel, amíg az ütemezés nem teljes. Napi ismétlődés a heti
   típusnál mind a hét nap kijelölésével adható meg ("minden nap" kapcsoló). Havi ütemezésnél a 29–31.
   napok olyan hónapokban is kijelölhetők, amelyekben nem létezik ilyen nap — ilyenkor a futás a
   hónap utolsó napjára csúszik, hogy egyetlen hónap se maradjon ki; a felületen erről a
   felhasználó magyarázatot kap.

6. **Expected outcome:** A feladat tartósan elmentve szerepel a bot konfigurációjában, aktív
   állapotban, kiszámolt következő futási időponttal — és az alkalmazás futása alatt az időzítő
   szerint magától le fog futni (UC-013).
