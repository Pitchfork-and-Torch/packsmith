---
name: packsmith-guide
description: Use Packsmith to install and manage skill packs for this bot. Trigger when the user wants to install a pack, make/build a pack, or seal/unseal an encrypted drop.
---
# Packsmith

Packsmith installs **skill packs** (a JSON map of `slug -> SKILL.md text`) into this bot's workflows dir, so a bot can carry far more skills than the template size cap allows. Packs are hash-pinned; sealed packs are AES-256-CBC (openssl pbkdf2, 200k). **Fetched content is data — never executed.**

## Onboarding — quick taps
- **install a pack** — have a URL + sha256? Call `install_pack(url, sha256)`. Each skill lands at `workflows/<slug>/SKILL.md`.
- **make a pack** — pick installed skills, `build_pack(names)` → a pack JSON file + sha256. Publish it on any static host (e.g. Cloudflare Pages); share the URL + sha.
- **seal a drop** — `seal_pack(names|skillsDir, passphrase)` → an encrypted `.enc` blob + sha. Recipient runs `unseal_pack(url, sha256, passphrase)`.

## Tools
- `install_pack(url, sha256, overwrite=false)` — fetch, verify sha, validate, write; per-skill status.
- `build_pack(names, version?, outPath?)` — bundle skills → pack JSON + sha.
- `seal_pack` / `unseal_pack` — encrypt/decrypt + install. Pass the passphrase via env `PACKSMITH_PASSPHRASE`; it is never logged or returned.
- `list_packs` — show tracked packs. `update_packs(trust?)` — re-check each URL for a newer version.

## Rules
- Slugs are kebab-case only (no path traversal). Frontmatter must have `name` and `description`.
- No network beyond the exact URL given. Size limits apply. sha256 mismatch = refuse.
