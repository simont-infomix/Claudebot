---
id: uc-012
title: "UC-012 — Ütemezett feladat szüneteltetése és újraaktiválása"
type: use-case
version: 0.1.0
created: 2026-10-27
updated: 2026-10-27
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
---

1. **Name:** Ütemezett feladat szüneteltetése és újraaktiválása

2. **Goal / short description:** A felhasználó ideiglenesen felfüggeszti egy feladat automatikus
   futását — anélkül, hogy a definícióját elveszítené —, majd később újra aktiválja. Jellemző
   okok: szabadság, egy külső rendszer karbantartása, vagy egy feladat átmeneti zajossága.
   - **2.1 Precondition:** A kiválasztott bothoz van legalább egy rögzített feladat.
   - **2.2 Exclusions:** Nem akadályozza meg a feladat kézi, azonnali futtatását (UC-014) — egy
     szüneteltetett feladat kézzel továbbra is elindítható.

3. **Actors:** Primary: felhasználó. Secondary: időzítő, bot-konfiguráció perzisztenciája.

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó a Feladatok tabon átváltja egy feladat aktív/szüneteltetett állapotát"]
    B --> C["A feladat vizuálisan jelzi az új állapotát"]
    C --> D["Felhasználó elmenti a módosítást"]
    D --> E["Az állapot a bot konfigurációjába kerül"]
    E --> F{"Szüneteltetett lett?"}
    F -- "Igen" --> G["Az időzítő nem ütemezi többé automatikus futásra"]
    F -- "Nem" --> H["Az időzítő kiszámolja a következő futási időpontot a mostani időtől"]
    G --> I(["End"])
    H --> I
```

5. **Potential errors:** Ha a feladat épp fut, amikor a felhasználó szüneteltetésre váltja, a
   folyamatban lévő futás nem szakad meg — a szüneteltetés csak a további automatikus futásokra
   vonatkozik.

6. **Expected outcome:** Egy szüneteltetett feladat az alkalmazás újraindítása után is
   szüneteltetett marad, és addig nem fut le magától, amíg a felhasználó újra nem aktiválja;
   újraaktiváláskor a következő futás a jelenlegi időponttól számítva esedékes, a szünet alatt
   kimaradt futásokat nem pótolja.
