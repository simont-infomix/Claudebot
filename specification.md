# Todo MCP szerver
Egy olyan MCP szerver és webes minialkalmazás, ami alkalmas Claude Code-al (vagy más coding agentel) végzett munka közben kimenteni a menet közben felmerülő, de azonnal nem megoldható vagy eldönthető feladatokat.

## MCP szerver
Úgy gondolom elég egyetlen tool: add_todo(repo, title, descriprion). A beérkező infókat egyszerűen leteszi egy SQLite db-be

### Webes miniapp
Az MCP-n érkezett TODO-k megjelenítésére és nyomonkövetésére szolgál. Vagyis a beérkező todo egy task, amihez további megjegyzéseket lehet fűzni.
