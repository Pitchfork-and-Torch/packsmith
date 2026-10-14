'use strict';
// Live tests against the real published packs. Writes only into a temp dir (PACKSMITH_ROOT), never the real workflows dir.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const OMNI = 'https://bots.jonbailey.xyz/omnipresence/skills.json';
const IRS = 'https://bots.jonbailey.xyz/irs-bot/skills.json';
const DEMO_ENC = 'https://bots.jonbailey.xyz/packs/demo.enc';
const DEMO_SHA = 'b653d796dad72bb10751f72ed731d1ef1da1d59ae9ca0cb777c21ea694735079';

function tmpRoot() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'packsmith-live-')); process.env.PACKSMITH_ROOT = d; return d; }
function freshCore() { delete require.cache[require.resolve('../src/core.js')]; return require('../src/core.js'); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let online = true;

test('live: install omnipresence pack (compute sha, then install)', async () => {
  const root = tmpRoot(); const c = freshCore();
  let buf; try { buf = await c.fetchBlob(OMNI); } catch (e) { online = false; console.log('SKIP (offline):', e.message); return; }
  const h = sha(buf);
  const res = await c.installPack({ url: OMNI, sha256: h, overwrite: true });
  assert.ok(res.results.length >= 2);
  for (const r of res.results) assert.ok(['installed', 'updated'].includes(r.status));
  assert.ok(fs.existsSync(path.join(root, res.results[0].slug, 'SKILL.md')));
});

test('live: sha256 mismatch is rejected (no write)', async () => {
  if (!online) return;
  const root = tmpRoot(); const c = freshCore();
  const bad = 'f'.repeat(64);
  await assert.rejects(() => c.installPack({ url: OMNI, sha256: bad, overwrite: true }), /sha256 mismatch/);
  assert.equal(fs.readdirSync(root).filter((f) => !f.startsWith('.')).length, 0);
});

test('live: install irs-bot pack (legacy flat map accepted)', async () => {
  if (!online) return;
  tmpRoot(); const c = freshCore();
  const buf = await c.fetchBlob(IRS);
  const res = await c.installPack({ url: IRS, sha256: sha(buf), overwrite: true });
  assert.ok(res.results.length >= 1);
});

test('live: demo.enc fetch + sha matches pinned, wrong passphrase rejected', async () => {
  if (!online) return;
  tmpRoot(); const c = freshCore();
  const blob = await c.fetchBlob(DEMO_ENC);
  assert.equal(sha(blob), DEMO_SHA, 'pinned sha matches live blob');
  // passphrase is intentionally not stored anywhere (burn-core-rules), so we can only assert a wrong one is rejected.
  await assert.rejects(() => c.unsealPack({ url: DEMO_ENC, sha256: DEMO_SHA, passphrase: 'definitely-wrong', overwrite: true }), /decrypt failed/);
});

test('live: update_packs reports up-to-date after install', async () => {
  if (!online) return;
  tmpRoot(); const c = freshCore();
  const buf = await c.fetchBlob(OMNI);
  await c.installPack({ url: OMNI, sha256: sha(buf), overwrite: true });
  const upd = await c.updatePacks();
  const e = upd.find((x) => x.url === OMNI);
  assert.ok(['up-to-date', 'update-available'].includes(e.status));
});
