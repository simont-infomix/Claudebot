---
id: uc-005
title: "UC-005 — Csatolt fájl eltávolítása küldés előtt"
type: use-case
version: 0.1.0
created: 2026-10-26
updated: 2026-10-26
references:
  - architecture-c3-react-ui
---

1. **Name:** Csatolt fájl eltávolítása küldés előtt

2. **Goal / short description:** A felhasználó egy már a chat-bevitelbe húzott/beillesztett, de
   még el nem küldött fájlt meggondol, és eltávolítja azt, mielőtt elküldené az üzenetet.
   - **2.1 Precondition:** A felhasználó legalább egy fájlt csatolt (drag&drop vagy vágólap) a
     ChatInput-hoz, az üzenet még nincs elküldve.
   - **2.2 Exclusions:** Nem tárgyalja a fájl csatolásának módját (drag&drop, vágólap) és az
     üzenet tényleges elküldését — ezeket a UC-002 fedi le.

3. **Actors:** Primary: felhasználó. Secondary: –

4. **Flow:**
```mermaid
flowchart TD
    A(["Start"]) --> B["Felhasználó egy vagy több fájlt csatol a ChatInput-hoz"]
    B --> C["Minden csatolt fájlhoz megjelenik egy eltávolítható chip (AttachmentChip)"]
    C --> D["Felhasználó rákattint egy chip eltávolító gombjára"]
    D --> E["A React UI helyi állapotból törli az adott csatolmányt — nincs hívás a hoszt felé"]
    E --> F["A chip eltűnik, a többi csatolmány és a begépelt szöveg változatlan marad"]
    F --> G(["End"])
```

5. **Potential errors:** –

6. **Expected outcome:** Az eltávolított fájl nem kerül elküldésre az üzenettel együtt; a
   felhasználó a megmaradt csatolmányokkal (vagy csatolmány nélkül) küldheti el az üzenetet.
