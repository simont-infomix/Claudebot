# ClaudeBot — dokumentum-index

| id | Cím | Típus | Útvonal |
|---|---|---|---|
| uc-001 | UC-001 — Új bot (agent-session) létrehozása | use-case | docs/use-cases/uc-001-uj-bot-letrehozasa.md |
| uc-002 | UC-002 — Üzenet küldése az agentnek, csatolt fájllal | use-case | docs/use-cases/uc-002-uzenet-kuldese-csatolt-fajllal.md |
| uc-003 | UC-003 — Bot terminál-munkamenetének megnyitása | use-case | docs/use-cases/uc-003-bot-terminal-megnyitasa.md |
| uc-004 | UC-004 — Bot munkamappájának megnyitása Intézőben | use-case | docs/use-cases/uc-004-munkamappa-megnyitasa.md |
| uc-005 | UC-005 — Csatolt fájl eltávolítása küldés előtt | use-case | docs/use-cases/uc-005-csatolt-fajl-eltavolitasa-kuldes-elott.md |
| uc-006 | UC-006 — Bot beállításainak gyors elérése a jobbklikk menüből | use-case | docs/use-cases/uc-006-bot-beallitasok-gyors-elerese-jobbklikkbol.md |
| uc-007 | UC-007 — Bot nyers kommunikációjának visszakeresése hibakereséshez (debug napló) | use-case | docs/use-cases/uc-007-debug-naplo-hibakereseshez.md |
| uc-008 | UC-008 — Bot futási beállításainak (model/effort/permission mode) módosítása | use-case | docs/use-cases/uc-008-bot-futasi-beallitasok-modositasa.md |
| uc-009 | UC-009 — Bot engedélyezett tool-jainak szabályozása | use-case | docs/use-cases/uc-009-bot-tool-engedelyek-szabalyozasa.md |
| uc-010 | UC-010 — Ütemezett feladat definiálása egy bot számára | use-case | docs/use-cases/uc-010-utemezett-feladat-definialasa.md |
| uc-011 | UC-011 — Ütemezett feladat módosítása vagy törlése | use-case | docs/use-cases/uc-011-utemezett-feladat-modositasa-torlese.md |
| uc-012 | UC-012 — Ütemezett feladat szüneteltetése és újraaktiválása | use-case | docs/use-cases/uc-012-utemezett-feladat-szuneteltetese.md |
| uc-013 | UC-013 — Ütemezett feladat automatikus lefutása | use-case | docs/use-cases/uc-013-utemezett-feladat-automatikus-lefutasa.md |
| uc-014 | UC-014 — Ütemezett feladat azonnali, kézi futtatása | use-case | docs/use-cases/uc-014-utemezett-feladat-kezi-futtatasa.md |
| uc-015 | UC-015 — Feladat-futások állapotának áttekintése | use-case | docs/use-cases/uc-015-feladat-futasok-attekintese.md |
| uc-016 | UC-016 — Bot végleges törlése | use-case | docs/use-cases/uc-016-bot-torlese.md |
| uc-017 | UC-017 — Olvasatlan bot-üzenet jelzése | use-case | docs/use-cases/uc-017-olvasatlan-uzenet-jelzese.md |
| uc-018 | UC-018 — Bot eszközhasználatának interaktív jóváhagyása | use-case | docs/use-cases/uc-018-tool-hasznalat-interaktiv-jovahagyasa.md |
| uc-019 | UC-019 — Megosztott skill vagy sub agent felvétele minden bot számára | use-case | docs/use-cases/uc-019-megosztott-skill-sub-agent-felvetele.md |
| architecture-c1 | Architektúra diagram — C1 (System Context) | architecture-c1 | docs/architecture-c1.md |
| architecture-c2-claude-bot | Architektúra diagram — C2 (Container) – ClaudeBot | architecture-c2 | docs/architecture-c2/claude-bot.md |
| architecture-c3-winforms-host | Architektúra diagram — C3 (Component) – WinForms Host | architecture-c3 | docs/architecture-c3/winforms-host.md |
| architecture-c3-react-ui | Architektúra diagram — C3 (Component) – React UI | architecture-c3 | docs/architecture-c3/react-ui.md |
| architecture-c3-bot-workspace | Architektúra diagram — C3 (Component) – Bot workspace | architecture-c3 | docs/architecture-c3/bot-workspace.md |
| architecture-c3-claude-code-cli-session | Architektúra diagram — C3 (Component) – Claude Code CLI session | architecture-c3 | docs/architecture-c3/claude-code-cli-session.md |
| ui-design-guideline | UI design szabályzat | ui-design-guideline | docs/ui-design-guideline.md |
| decision-01 | ADR-0001 — Ütemezett feladatok futtatása pollozó időzítővel, a definícióból számolt következő futással | adr | docs/adr/0001-utemezett-feladatok-pollozo-idozitovel.md |
| decision-02 | ADR-0002 — Az alkalmazás alapértelmezetten a Windowsszal indul, tálcaikonnal | adr | docs/adr/0002-windows-indulas-es-talcaikon.md |
| decision-03 | ADR-0003 — Az ablak bezárása a tálcára rejt, az automatikus indítás kapcsolható | adr | docs/adr/0003-talcara-rejtes-es-kapcsolhato-autostart.md |
| decision-04 | ADR-0004 — Interaktív tool-jóváhagyás a claude.exe stdio control-protokollján | adr | docs/adr/0004-interaktiv-jovahagyas-a-cli-control-protokollon.md |
| bug-001 | BUG-001 — A bot-terminál (cmd + claude + MCP-szerver) nem áll le az app bezárásakor | bug | docs/bugs/bug-001-terminal-folyamat-nem-all-le-bezaraskor.md |
| bug-002 | BUG-002 — Settings lapról elnavigálva nem jelez mentetlen módosítást | bug | docs/bugs/bug-002-settings-elnavigalas-mentetlen-valtozas-nelkul.md |
| bug-003 | BUG-003 — A claudebot-stream.log Production buildben is íródik | bug | docs/bugs/bug-003-debug-naplo-production-buildben-is-irodik.md |
| bug-004 | BUG-004 — Nincs mód interaktív tool-jóváhagyásra; a bot nem értesül az elutasításról | bug | docs/bugs/bug-004-nincs-interaktiv-jovahagyas-csatorna.md |
| bug-005 | BUG-005 — Tálcára rejtett állapotban újraindítva az app párhuzamos második példány indul | bug | docs/bugs/bug-005-tobbszoros-inditas-parhuzamos-instance.md |
| bug-006 | BUG-006 — A Bots/ mappa minden alkönyvtárát (rejtett mappát is) botnak tölti be | bug | docs/bugs/bug-006-rejtett-mappak-botkent-toltodnek-be.md |
