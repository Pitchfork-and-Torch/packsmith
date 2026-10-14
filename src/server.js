'use strict';
// Packsmith MCP server: zero-dependency stdio JSON-RPC 2.0 (MCP subset). Node built-ins only.
const core = require('./core.js');

const TOOLS = [
  { name: 'install_pack', description: 'Fetch a skill pack JSON from url, verify sha256, validate, and write each skill to the workflows dir. Never executes pack content.',
    inputSchema: { type: 'object', required: ['url', 'sha256'], properties: {
      url: { type: 'string', description: 'https URL of the pack JSON' },
      sha256: { type: 'string', description: '64-hex expected sha256 of the fetched bytes' },
      overwrite: { type: 'boolean', description: 'overwrite existing skills (default false)' } } } },
  { name: 'seal_pack', description: 'Encrypt named skills (or every skill under skillsDir) into an openssl-compatible AES-256-CBC pbkdf2 blob. Passphrase via env PACKSMITH_PASSPHRASE or args.passphrase; never logged or returned.',
    inputSchema: { type: 'object', properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'skill slugs to seal' },
      skillsDir: { type: 'string', description: 'directory of <slug>/SKILL.md to seal instead of names' },
      passphrase: { type: 'string', description: 'passphrase (prefer env PACKSMITH_PASSPHRASE)' },
      outPath: { type: 'string', description: 'where to write the .enc blob' } } } },
  { name: 'unseal_pack', description: 'Fetch an encrypted pack from url, verify sha256, decrypt with passphrase, and install skills. Passphrase via env PACKSMITH_PASSPHRASE or args.passphrase; never logged or returned.',
    inputSchema: { type: 'object', required: ['url', 'sha256'], properties: {
      url: { type: 'string' }, sha256: { type: 'string' }, passphrase: { type: 'string' }, overwrite: { type: 'boolean' } } } },
  { name: 'build_pack', description: 'Bundle named installed skills into a pack JSON file and return its sha256. Publishing is user-side (any static host).',
    inputSchema: { type: 'object', required: ['names'], properties: {
      names: { type: 'array', items: { type: 'string' } }, version: { type: 'string' }, outPath: { type: 'string' } } } },
  { name: 'list_packs', description: 'List installed packs tracked in the manifest (url, sha256, version, skills, installedAt).', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_packs', description: 'Re-fetch each tracked pack URL and report up-to-date / update-available. Pass trust:true to apply newly-fetched shas.',
    inputSchema: { type: 'object', properties: { trust: { type: 'boolean' }, overwrite: { type: 'boolean' } } } },
];

function envPass(args) { return (args && args.passphrase) || process.env.PACKSMITH_PASSPHRASE || ''; }

async function callTool(name, args = {}) {
  switch (name) {
    case 'install_pack': return core.installPack({ url: args.url, sha256: args.sha256, overwrite: !!args.overwrite });
    case 'seal_pack': { const r = core.sealPack({ names: args.names, skillsDir: args.skillsDir, passphrase: envPass(args), outPath: args.outPath }); return r; }
    case 'unseal_pack': return core.unsealPack({ url: args.url, sha256: args.sha256, passphrase: envPass(args), overwrite: !!args.overwrite });
    case 'build_pack': { const r = core.buildPack({ names: args.names, version: args.version, outPath: args.outPath }); delete r.json; return r; }
    case 'list_packs': return core.listPacks();
    case 'update_packs': return core.updatePacks({ trust: !!args.trust, overwrite: args.overwrite !== false });
    default: throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'packsmith', version: '0.1.0' } });
    if (method === 'notifications/initialized') return null;
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      const out = await callTool(params.name, params.arguments || {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    }
    return fail(-32601, `method not found: ${method}`);
  } catch (e) {
    if (id === undefined) return null;
    return reply({ content: [{ type: 'text', text: `ERROR: ${e.message || e}` }], isError: true });
  }
}

function main() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const res = await handle(msg);
      if (res) process.stdout.write(JSON.stringify(res) + '\n');
    }
  });
}
if (require.main === module) main();
module.exports = { handle, callTool, TOOLS };
