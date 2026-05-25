# 🤖 MCP Server — Rufaqaa AI Tools

> Python 3.12 · [Model Context Protocol](https://modelcontextprotocol.io/) · FastMCP · httpx

Bridges Claude (Desktop / Web / API) to the Rufaqaa REST API: Claude can list
and inspect orphans, donors and sponsorships, and create new sponsorships, by
calling MCP tools.

---

## 📊 Status

**🟢 Phase 3 — Skeleton** (runs, talks to the backend, ships with tests)

Tools registered:

| Tool | Backend endpoint |
|---|---|
| `list_orphans` | `GET /api/v1/orphans` |
| `get_orphan` | `GET /api/v1/orphans/{id}` |
| `list_donors` | `GET /api/v1/donors` |
| `list_sponsorships` | `GET /api/v1/sponsorships` |
| `create_sponsorship` | `POST /api/v1/sponsorships` |

The longer roadmap in [`docs/technical/04_mcp_tools.md`](../docs/technical/04_mcp_tools.md)
lists 30+ tools across 9 categories — they will be added incrementally as the
backend endpoints land.

---

## 🚀 Run it

### Setup

```bash
cd mcp-server
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Configure (env vars or `.env` in repo root):

| Variable | Default | Meaning |
|---|---|---|
| `RUFAQAA_MCP_API_URL` | `http://localhost:8000/api/v1` | Backend base URL |
| `RUFAQAA_MCP_API_EMAIL` | `admin@dev.rufaqaa.app` | Login email |
| `RUFAQAA_MCP_API_PASSWORD` | `admin12345` | Login password |
| `RUFAQAA_MCP_HTTP_TIMEOUT_SECONDS` | `15` | Per-request timeout |

### Standalone (stdio)

```bash
rufaqaa-mcp
# or
python -m rufaqaa_mcp.server
```

### From Claude Desktop

Add to your `claude_desktop_config.json` (macOS path:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rufaqaa": {
      "command": "/absolute/path/to/mcp-server/.venv/bin/rufaqaa-mcp",
      "env": {
        "RUFAQAA_MCP_API_URL": "http://localhost:8000/api/v1",
        "RUFAQAA_MCP_API_EMAIL": "admin@dev.rufaqaa.app",
        "RUFAQAA_MCP_API_PASSWORD": "admin12345"
      }
    }
  }
}
```

Restart Claude Desktop — the Rufaqaa tools appear in the tools picker.

---

## 🧪 Tests

```bash
pytest                            # respx-mocked unit tests (no backend needed)
ruff check rufaqaa_mcp tests
```

End-to-end against the live backend:

```bash
# with backend running on :8000 and seeded
python -c "
import asyncio
from rufaqaa_mcp.client import RufaqaaClient

async def main():
    c = RufaqaaClient()
    print(await c.list_orphans(limit=3))
    await c.aclose()

asyncio.run(main())
"
```

---

## 🏗️ Layout

```
mcp-server/
├── rufaqaa_mcp/
│   ├── config.py    # Pydantic settings (RUFAQAA_MCP_*)
│   ├── client.py    # Async httpx client; lazy login + 401 retry
│   └── server.py    # FastMCP entry; registers tools
├── tests/
│   └── test_client.py    # respx-mocked unit tests
├── pyproject.toml
└── README.md
```

---

## 🔐 Authentication

The skeleton uses a single Rufaqaa user (configured email + password). On the
first tool call it logs in and caches the access token; on any 401 it
re-authenticates once and retries the original request. The backend's
Row-Level Security middleware scopes all reads/writes to that user's
organization.

A future phase will replace this with a service-account API key issued from
the Rufaqaa admin UI (the schema already includes the `api_keys` table).
