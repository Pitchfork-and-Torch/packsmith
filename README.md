# Packsmith

A zero-dependency Grok Bot / Agent plugin (stdio MCP server + one skill) that installs and manages **skill packs** for Grok Bots. It moves the capacity limit off the install template and onto a hash-pinned pack you host yourself, so a bot can carry far more skills than the template size cap allows — and it does not depend on the `UpdateSkill` tool.

A **skill** is installed by writing `<workflows>/<slug>/SKILL.md` (markdown with `name` + `description` frontmatter). The default workflows root is `/home/box/agent-data/workflows`, overridable with `PACKSMITH_ROOT` (used by the tests so they never touch the real dir).

## Data shapes
- **Pack**: `{ "version"?: string, "skills": { "<kebab-slug>": "<SKILL.md text>" } }`. A legacy flat map `{ "skills/<slug>/SKILL.md": "<text>" }` (or `{ "<slug>": "<text>" }`) is also accepted.
- **Manifest** (`<workflows>/.packsmith.json`): `[{ url, sha256, version, skills[], installedAt, sealed? }]`.

## Tools
| Tool | What it does |
|------|--------------|
| `install_pack(url, sha256, overwrite=false)` | Fetch pack JSON, verify sha256, validate, write each skill. Per-skill status. |
| `build_pack(names, version?, outPath?)` | Bundle installed skills into a pack JSON file; returns sha256. |
| `seal_pack(names \| skillsDir, passphrase, outPath?)` | Encrypt skills into an openssl-compatible `.enc` blob; returns sha256. |
| `unseal_pack(url, sha256, passphrase, overwrite=false)` | Fetch + verify + decrypt + install. |
| `list_packs()` | List tracked packs from the manifest. |
| `update_packs(trust=false, overwrite=true)` | Re-fetch each tracked URL; report `up-to-date` / `update-available`; apply only with `trust:true` (or re-run `install_pack` with the new sha). |

**Content is never executed.** Packs are data: Packsmith only writes SKILL.md text.

## Encryption format
`seal_pack`/`unseal_pack` are byte-compatible with:
```
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass env:PASS
```
(`Salted__` + 8-byte salt + AES-256-CBC, key/iv via PBKDF2-SHA256, 200k iterations). Pass the passphrase via env `PACKSMITH_PASSPHRASE` (preferred) or the `passphrase` arg — it is never logged or returned.

## Safety
- https-only (set `PACKSMITH_ALLOW_HTTP=1` for tests), optional host allowlist via `PACKSMITH_ALLOWED_HOSTS`.
- Slugs are kebab-case only — path-traversal guard. Frontmatter must contain `name` and `description`.
- Size limits: `PACKSMITH_MAX_PACK_BYTES` (1 MiB), `PACKSMITH_MAX_SKILL_BYTES` (64 KiB), `PACKSMITH_MAX_SKILLS` (100).
- No network beyond the exact URL given; redirects are not followed. sha256 mismatch = refuse, no write.

## Publishing a pack (user-side)
1. `build_pack(["my-skill-a","my-skill-b"], "1")` → a pack JSON file + sha256.
2. Upload the JSON to any static host — e.g. **Cloudflare Pages**, GitHub Pages, S3, or your bot hub.
3. Share the URL + sha256. Recipients run `install_pack(url, sha256)`. For a private drop, `seal_pack` first and share the passphrase out of band; recipients run `unseal_pack`.

## Run
```
node src/server.js        # stdio MCP server
npm test                  # node --test (unit + live)
```

## Layout
```
plugin.json  mcp.json  package.json  README.md
src/core.js  src/server.js
skills/packsmith-guide/SKILL.md
test/unit.test.js  test/live.test.js
```

## Transport note

Packsmith ships as a local **stdio** MCP server (`node src/server.js`, zero dependencies). `mcp.json` follows the Agent Plugins standard (`${PLUGIN_ROOT}`); `mcp.cursor.json` is the Cursor variant (`${CURSOR_PLUGIN_ROOT}`). Hosts that only accept remote (HTTP/SSE) MCP servers will need a hosted endpoint; that is not provided yet.

## License

MIT
