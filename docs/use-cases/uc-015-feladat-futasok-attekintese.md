---
id: uc-015
title: "UC-015 — Feladat-futások állapotának áttekintése"
type: use-case
version: 0.1.0
created: 2026-10-27
updated: 2026-10-27
references:
  - architecture-c3-react-ui
  - architecture-c3-winforms-host
---

1. **Name:** Feladat-futások állapotának áttekintése

2. **Goal / short description:** A felhasználó megnézi, hogy a bot feladatai ténylegesen
   lefutottak-e: mikor futott utoljára egy feladat, sikeres volt-e, és mikor esedékes a
   következő futás. Enélkül egy magától dolgozó bot működése átláthatatlan lenne.
   - **2.1 Precondition:** A kiválasztott bothoz van legalább egy rögzített feladat.
   - **2.2 Exclusions:** Nem tartalmazza a feladat válaszának részletes megjelenítését — a
     feladat tényleges kimenete a bot csevegésében olvasható; itt csak a futás ténye és
     kimenetele látszik.

3. **Actors:** Primary: felhasználó. Secondary: –

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó megnyitja a kiválasztott bot Feladatok tabját"]
    B --> C["Minden feladatnál látja az aktív/szüneteltetett állapotot"]
    C --> D["Látja az utolsó futás időpontját és kimenetelét (sikeres / sikertelen / kihagyott)"]
    D --> E["Aktív feladatnál látja a következő esedékes futás időpontját"]
    E --> F{"Volt sikertelen futás?"}
    F -- "Igen" --> G["Megnézi a sikertelenség okát, és a csevegésben a részleteket"]
    F -- "Nem" --> H["Nyugtázza, hogy a feladatok rendben futnak"]
    G --> I(["End"])
    H --> I
```

5. **Potential errors:** Egy feladat még sosem futott le → futási időpont helyett ezt jelző
   szöveg látszik, nem üres mező.

6. **Expected outcome:** A felhasználó egy pillantással látja, hogy a bot feladatai élnek-e,
   mikor dolgoztak utoljára, és mi várható — így észreveszi, ha egy feladat némán elhasalt.
