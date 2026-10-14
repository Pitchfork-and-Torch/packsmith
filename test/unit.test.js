'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function tmpRoot() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'packsmith-')); process.env.PACKSMITH_ROOT = d; return d; }
function freshCore() { delete require.cache[require.resolve('../src/core.js')]; return require('../src/core.js'); }

test('slug guard rejects traversal and non-kebab', () => {
  const c = freshCore();
  assert.throws(() => c.assertSlug('../evil'));
  assert.throws(() => c.assertSlug('a/b'));
  assert.throws(() => c.assertSlug('Foo_Bar'));
  assert.throws(() => c.assertSlug('UPPER'));
  assert.equal(c.assertSlug('good-slug-1'), 'good-slug-1');
});

test('keyToSlug accepts hub forms, rejects traversal', () => {
  const c = freshCore();
  assert.equal(c.keyToSlug('skills/foo-bar/SKILL.md'), 'foo-bar');
  assert.equal(c.keyToSlug('foo-bar/SKILL.md'), 'foo-bar');
  assert.equal(c.keyToSlug('foo-bar'), 'foo-bar');
  assert.throws(() => c.keyToSlug('skills/../../etc/SKILL.md'));
});

test('frontmatter must have name + description', () => {
  const c = freshCore();
  assert.throws(() => c.validateSkill('x', '# no frontmatter'));
  assert.throws(() => c.validateSkill('x', '---\nname: only\n---\nbody'));
  assert.doesNotThrow(() => c.validateSkill('x', '---\nname: n\ndescription: d\n---\nbody'));
});

test('normalizePack handles new and legacy shapes', () => {
  const c = freshCore();
  const sk = '---\nname: n\ndescription: d\n---\nbody';
  const a = c.normalizePack({ version: '2', skills: { 'a-b': sk } });
  assert.equal(a.version, '2'); assert.deepEqual(Object.keys(a.skills), ['a-b']);
  const b = c.normalizePack({ 'skills/a-b/SKILL.md': sk });
  assert.equal(b.version, null); assert.deepEqual(Object.keys(b.skills), ['a-b']);
  assert.throws(() => c.normalizePack({}));
});

test('crypto roundtrip (our encrypt -> our decrypt)', () => {
  const c = freshCore();
  const blob = c.opensslEncrypt(Buffer.from('secret payload'), 'pw');
  assert.ok(blob.subarray(0, 8).equals(Buffer.from('Salted__')));
  assert.equal(c.opensslDecrypt(blob, 'pw').toString(), 'secret payload');
  assert.throws(() => c.opensslDecrypt(blob, 'wrong'));
});

test('verifySha rejects mismatch and bad hex', () => {
  const c = freshCore();
  const buf = Buffer.from('abc');
  const good = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(c.verifySha(buf, good), good);
  assert.throws(() => c.verifySha(buf, 'deadbeef'));
  assert.throws(() => c.verifySha(buf, good.replace(/.$/, '0')));
});

test('allowedHost enforces https and allowlist', () => {
  const c = freshCore();
  assert.throws(() => c.allowedHost('http://x.com/a'));
  process.env.PACKSMITH_ALLOWED_HOSTS = 'ok.com';
  assert.throws(() => c.allowedHost('https://bad.com/a'));
  assert.doesNotThrow(() => c.allowedHost('https://ok.com/a'));
  delete process.env.PACKSMITH_ALLOWED_HOSTS;
});

test('build -> seal -> unseal roundtrip installs skills (own blob)', async () => {
  tmpRoot();
  const c = freshCore();
  const dir = c.root();
  for (const s of ['alpha-one', 'beta-two']) {
    fs.mkdirSync(path.join(dir, s), { recursive: true });
    fs.writeFileSync(path.join(dir, s, 'SKILL.md'), `---\nname: ${s}\ndescription: test skill ${s}\n---\nbody of ${s}`);
  }
  const built = c.buildPack({ names: ['alpha-one', 'beta-two'], version: '1', outPath: path.join(os.tmpdir(), 'p.json') });
  assert.equal(built.skills.length, 2);
  // seal to a blob
  const blobPath = path.join(os.tmpdir(), `seal-${Date.now()}.enc`);
  const sealed = c.sealPack({ names: ['alpha-one', 'beta-two'], passphrase: 'pw123', outPath: blobPath });
  assert.match(sealed.sha256, /^[0-9a-f]{64}$/);
  // serve the blob over a local http server and unseal into a fresh root
  const http = require('node:http');
  const data = fs.readFileSync(blobPath);
  const srv = http.createServer((req, res) => { res.end(data); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/seal.enc`;
  const newRoot = tmpRoot(); const c2 = freshCore();
  process.env.PACKSMITH_ALLOW_HTTP = '1';
  const res = await c2.unsealPack({ url, sha256: sealed.sha256, passphrase: 'pw123', overwrite: true });
  srv.close(); delete process.env.PACKSMITH_ALLOW_HTTP;
  assert.equal(res.results.length, 2);
  assert.ok(fs.existsSync(path.join(newRoot, 'alpha-one', 'SKILL.md')));
  assert.equal(c2.listPacks().length, 1);
});
