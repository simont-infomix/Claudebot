---
id: uc-018
title: "UC-018 — Bot eszközhasználatának interaktív jóváhagyása"
type: use-case
version: 0.1.0
created: 2026-10-30
updated: 2026-10-30
references:
  - uc-009
  - uc-013
  - uc-017
  - decision-04
  - architecture-c3-claude-code-cli-session
---

1. **Name:** Bot eszközhasználatának interaktív jóváhagyása

2. **Goal / short description:** A felhasználó futásidőben, esetenként dönt arról, hogy a bot
   használhat-e egy olyan eszközt, amire nincs előzetes engedélye — ahelyett, hogy az ilyen
   hívás némán elutasításra kerülne, és a bot egy megválaszolhatatlan kérdéssel maradna. A
   döntés háromféle lehet: egyszeri engedély, tartós engedély (az eszköz felkerül a bot
   engedélyezett listájára), vagy elutasítás.
   - **2.1 Precondition:** A boton be van kapcsolva az interaktív jóváhagyás (Beállítások lap),
     és a bot olyan eszközt hívna, amit sem az engedélyezett lista, sem a Permission mode nem
     enged automatikusan.
   - **2.2 Exclusions:** Nem ad módot a kért művelet *módosítására* (a paraméterek csak
     megtekinthetők, nem szerkeszthetők), és nem helyettesíti az engedélyezett eszközök
     listájának karbantartását a Képességek fülön.

3. **Actors:** Primary: felhasználó. Secondary: `claude.exe` (a kérés kezdeményezője),
   `BotSession` (a kérések nyilvántartása és a válasz küldése), `BotTaskScheduler` (az
   ütemezett futás kimenetele).

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["A bot egy nem engedélyezett eszközt hívna"]
    B --> C["A csevegésben megjelenik a jóváhagyási kártya: eszköz neve, a kért művelet, lenyitható részletek"]
    C --> D{"A felhasználó dönt a határidőn belül?"}
    D -- "Engedélyezem" --> E["A bot végrehajtja a műveletet, és folytatja a választ"]
    D -- "Mindig engedélyezd" --> F["Az eszköz felkerül a bot engedélyezett listájára; a bot folytatja, újraindítás nélkül"]
    D -- "Elutasítom" --> G["A bot értesül az elutasításról, és szövegesen reagál rá"]
    D -- "Nincs válasz a határidőig" --> H["Automatikus elutasítás; ütemezett futásnál a feladat sikertelen lesz"]
    E --> I(["End"])
    F --> I
    G --> I
    H --> I
```

5. **Potential errors:**
   - A bot a döntés előtt leáll vagy újraindul: a kérés azonosítója érvényét veszti, a kártya
     érvénytelen állapotba kerül, és a felhasználó válasza már nem érvényesíthető.
   - A tartós engedély a futó folyamatra nem érvényesül (a CLI elvetheti a futásidejű
     szabályt): ilyenkor a bot ugyanarra az eszközre újra rákérdez, de a mentett lista miatt a
     következő indulás után már nem.

6. **Expected outcome:** A bot egyetlen eszközhívása sem vész el némán: vagy a felhasználó
   döntése alapján fut le, vagy indokolt elutasítást kap, amiről a bot is értesül és reagál rá.
   Ütemezett futásnál a válasz nélkül maradt kérés sikertelen futásként jelenik meg a Feladatok
   nézetben, a konkrét okkal.
