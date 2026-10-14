# Packsmith — plugin submission

**Name:** Packsmith
**Version:** 0.1.0
**Type:** Agent plugin — stdio MCP server + one skill. Zero runtime dependencies (Node ≥18 built-ins only).

## Summary
Packsmith installs and manages **skill packs** for Grok Bots. A pack is a hash-pinned JSON map of `slug → SKILL.md text`; Packsmith fetches it, verifies its sha256, validates it, and writes each skill into the bot's workflows directory. This moves the capacity limit off the install template and onto a pack the author hosts on any static host, letting a bot carry far more skills than the template size cap allows, without relying on a single built-in skill-update tool.

## Tools
- `install_pack(url, sha256, overwrite=false)` — fetch, verify, validate, write; per-skill status.
- `build_pack(names, version?, outPath?)` — bundle installed skills into a pack JSON + sha256.
- `seal_pack` / `unseal_pack` — encrypt skills into / install from an openssl-compatible AES-256-CBC (PBKDF2-SHA256, 200k) blob. Passphrase via env; never logged or returned.
- `list_packs` / `update_packs` — track installed packs and check for newer versions at the same URL.

## Safety
- Content is treated as data and never executed.
- https-only with an optional host allowlist; no network beyond the exact URL given; redirects not followed.
- sha256 verification is mandatory — a mismatch refuses with no write.
- kebab-case-only slug guard prevents path traversal; frontmatter must contain `name` and `description`.
- Configurable pack/per-skill/count size limits; writes root is overridable for testing.

## Testing
Unit tests (guards, pack normalization, crypto roundtrip, sha verification, host allowlist, build→seal→unseal) and live tests (install against real published packs, sha-mismatch rejection, encrypted-blob verification) run under `node --test`, writing only to a temp directory.
