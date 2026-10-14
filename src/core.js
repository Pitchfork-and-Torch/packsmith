'use strict';
// Packsmith core: zero-dependency (Node >=18 built-ins only). Never executes pack content.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = {
  pack: +process.env.PACKSMITH_MAX_PACK_BYTES || 1024 * 1024,
  skill: +process.env.PACKSMITH_MAX_SKILL_BYTES || 64 * 1024,
  count: +process.env.PACKSMITH_MAX_SKILLS || 100,
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const root = () => process.env.PACKSMITH_ROOT || '/home/box/agent-data/workflows';
const manifestPath = () => path.join(root(), '.packsmith.json');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function assertSlug(s) {
  if (typeof s !== 'string' || s.length > 64 || !SLUG.test(s)) throw new Error(`invalid slug: ${JSON.stringify(s)} (kebab-case only)`);
  return s;
}
function keyToSlug(k) {
  const m = /^(?:skills\/)?([^/]+)(?:\/SKILL\.md)?$/.exec(String(k));
  return assertSlug(m ? m[1] : k);
}
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}
function validateSkill(slug, text) {
  if (typeof text !== 'string') throw new Error(`${slug}: SKILL.md must be a string`);
  if (Buffer.byteLength(text) > LIMITS.skill) throw new Error(`${slug}: exceeds per-skill limit ${LIMITS.skill} bytes`);
  const fm = parseFrontmatter(text);
  if (!fm || !fm.name || !fm.description) throw new Error(`${slug}: frontmatter needs name and description`);
}
function normalizePack(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('pack must be a JSON object');
  const isNew = obj.skills && typeof obj.skills === 'object' && !Array.isArray(obj.skills);
  const map = isNew ? obj.skills : obj;
  const version = isNew && obj.version != null ? String(obj.version) : null;
  const entries = Object.entries(map);
  if (!entries.length) throw new Error('pack has no skills');
  if (entries.length > LIMITS.count) throw new Error(`pack exceeds ${LIMITS.count} skills`);
  const skills = {};
  for (const [k, v] of entries) { const s = keyToSlug(k); validateSkill(s, v); if (skills[s]) throw new Error(`duplicate slug ${s}`); skills[s] = v; }
  return { version, skills };
}
function allowedHost(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(process.env.PACKSMITH_ALLOW_HTTP === '1' && u.protocol === 'http:')) throw new Error('only https URLs allowed');
  const list = (process.env.PACKSMITH_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length && !list.includes(u.hostname.toLowerCase())) throw new Error(`host ${u.hostname} not in PACKSMITH_ALLOWED_HOSTS`);
  return u;
}
async function fetchBlob(url) {
  allowedHost(url);
  const res = await fetch(url, { redirect: 'error', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > LIMITS.pack) throw new Error(`pack exceeds ${LIMITS.pack} bytes`); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks);
}
function verifySha(buf, expected) {
  if (!/^[0-9a-f]{64}$/i.test(expected || '')) throw new Error('sha256 must be 64 hex chars');
  const got = sha256(buf);
  if (got !== expected.toLowerCase()) throw new Error(`sha256 mismatch: expected ${expected.toLowerCase()}, got ${got}`);
  return got;
}
// openssl enc -aes-256-cbc -pbkdf2 -iter 200000 compatible format.
const MAGIC = Buffer.from('Salted__');
function opensslEncrypt(plain, passphrase) {
  const salt = crypto.randomBytes(8);
  const keyiv = crypto.pbkdf2Sync(Buffer.from(passphrase), salt, 200000, 48, 'sha256');
  const key = keyiv.subarray(0, 32), iv = keyiv.subarray(32, 48);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([MAGIC, salt, c.update(plain), c.final()]);
}
function opensslDecrypt(blob, passphrase) {
  if (blob.length < 16 || !blob.subarray(0, 8).equals(MAGIC)) throw new Error('not an openssl salted blob');
  const salt = blob.subarray(8, 16);
  const keyiv = crypto.pbkdf2Sync(Buffer.from(passphrase), salt, 200000, 48, 'sha256');
  const key = keyiv.subarray(0, 32), iv = keyiv.subarray(32, 48);
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  try { return Buffer.concat([d.update(blob.subarray(16)), d.final()]); }
  catch { throw new Error('decrypt failed (wrong passphrase or corrupt blob)'); }
}
function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')); } catch { return []; }
}
function writeManifest(list) {
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify(list, null, 2) + '\n');
}
function upsertManifest(entry) {
  const list = readManifest().filter((e) => e.url !== entry.url);
  list.push(entry);
  writeManifest(list);
}
function writeSkills(skills, { overwrite }) {
  const results = [];
  for (const [slug, text] of Object.entries(skills)) {
    const dir = path.join(root(), slug);
    const file = path.join(dir, 'SKILL.md');
    const exists = fs.existsSync(file);
    if (exists && !overwrite) { results.push({ slug, status: 'skipped', reason: 'exists (overwrite=false)' }); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text);
    results.push({ slug, status: exists ? 'updated' : 'installed', bytes: Buffer.byteLength(text) });
  }
  return results;
}

async function installPack({ url, sha256: expected, overwrite = false }) {
  const buf = await fetchBlob(url);
  const got = verifySha(buf, expected);
  let parsed; try { parsed = JSON.parse(buf.toString('utf8')); } catch { throw new Error('pack is not valid JSON'); }
  const { version, skills } = normalizePack(parsed);
  const results = writeSkills(skills, { overwrite });
  upsertManifest({ url, sha256: got, version, skills: Object.keys(skills), installedAt: new Date().toISOString() });
  return { url, sha256: got, version, results };
}

function collectSkills(names) {
  const skills = {};
  for (const n of names) {
    const slug = assertSlug(n);
    const file = path.join(root(), slug, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    validateSkill(slug, text);
    skills[slug] = text;
  }
  return skills;
}

function buildPack({ names, version, outPath }) {
  const skills = collectSkills(names);
  const pack = version != null ? { version: String(version), skills } : { skills };
  const json = JSON.stringify(pack, null, 1);
  const buf = Buffer.from(json);
  if (outPath) fs.writeFileSync(outPath, buf);
  return { outPath, sha256: sha256(buf), bytes: buf.length, skills: Object.keys(skills), json };
}

function sealPack({ names, skillsDir, passphrase, outPath }) {
  if (!passphrase) throw new Error('passphrase required (pass via env/stdin, not argv)');
  let skills;
  if (skillsDir) {
    skills = {};
    for (const slug of fs.readdirSync(skillsDir)) {
      const file = path.join(skillsDir, slug, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      assertSlug(slug);
      const text = fs.readFileSync(file, 'utf8'); validateSkill(slug, text); skills[slug] = text;
    }
    if (!Object.keys(skills).length) throw new Error('no SKILL.md found under skillsDir');
  } else {
    skills = collectSkills(names || []);
  }
  const plain = Buffer.from(JSON.stringify({ skills }));
  const blob = opensslEncrypt(plain, passphrase);
  if (outPath) fs.writeFileSync(outPath, blob);
  return { outPath, sha256: sha256(blob), bytes: blob.length, skills: Object.keys(skills) };
}

async function unsealPack({ url, sha256: expected, passphrase, overwrite = false }) {
  if (!passphrase) throw new Error('passphrase required (pass via env/stdin, not argv)');
  const blob = await fetchBlob(url);
  const got = verifySha(blob, expected);
  const plain = opensslDecrypt(blob, passphrase);
  let parsed; try { parsed = JSON.parse(plain.toString('utf8')); } catch { throw new Error('decrypted content is not valid JSON'); }
  const { version, skills } = normalizePack(parsed);
  const results = writeSkills(skills, { overwrite });
  upsertManifest({ url, sha256: got, version, skills: Object.keys(skills), installedAt: new Date().toISOString(), sealed: true });
  return { url, sha256: got, version, results };
}

function listPacks() { return readManifest(); }

// update_packs: re-fetch each tracked URL. If blob sha changed we report an update is available.
// We only auto-install when the caller passes a new trusted sha256 (trust=explicit) OR trust:true to accept the newly-fetched sha.
async function updatePacks({ trust = false, overwrite = true } = {}) {
  const out = [];
  for (const e of readManifest()) {
    try {
      const buf = await fetchBlob(e.url);
      const got = sha256(buf);
      if (got === e.sha256) { out.push({ url: e.url, status: 'up-to-date', sha256: got }); continue; }
      if (!trust) { out.push({ url: e.url, status: 'update-available', oldSha: e.sha256, newSha: got, note: 'pass trust:true (or install_pack with the new sha256) to apply' }); continue; }
      const r = await installPack({ url: e.url, sha256: got, overwrite });
      out.push({ url: e.url, status: 'updated', sha256: got, version: r.version, results: r.results });
    } catch (err) { out.push({ url: e.url, status: 'error', error: String(err.message || err) }); }
  }
  return out;
}

module.exports = {
  LIMITS, root, manifestPath, sha256, assertSlug, keyToSlug, parseFrontmatter, validateSkill,
  normalizePack, allowedHost, fetchBlob, verifySha, opensslEncrypt, opensslDecrypt,
  readManifest, writeManifest, writeSkills, installPack, buildPack, sealPack, unsealPack, listPacks, updatePacks, collectSkills,
};
