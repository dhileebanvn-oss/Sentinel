'use strict';
/* Sentinel – gate control server. No framework; only `pg` (when DATABASE_URL is set). */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000, SECRET = process.env.SESSION_SECRET || 'dev-only-secret';
const SETUP_KEY = process.env.SETUP_KEY || '', PROD = process.env.NODE_ENV === 'production';
const DAY = 864e5, TEAMS = ['security', 'inward', 'dispatch', 'safety', 'hr'];
if (PROD && !process.env.SESSION_SECRET) { console.error('SESSION_SECRET is required in production'); process.exit(1); }

/* ---------- storage: Postgres on Render, JSON file for local testing ---------- */
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg'), url = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: /render\.com/.test(url) || process.env.PGSSL === 'on' ? { rejectUnauthorized: false } : false });
  /* Optional: set DB_SCHEMA (e.g. sentinel) so several apps can share one database without touching each other's tables */
  const schema = (process.env.DB_SCHEMA || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (schema) pool.on('connect', c => c.query('set search_path to ' + schema + ', public'));
  store = {
    init: async () => { if (schema) await pool.query('create schema if not exists ' + schema); await pool.query('create table if not exists docs(col text not null, id text not null, data jsonb not null, primary key(col,id))'); },
    list: async c => (await pool.query('select id,data from docs where col=$1', [c])).rows,
    get: async (c, i) => (await pool.query('select data from docs where col=$1 and id=$2', [c, i])).rows[0]?.data || null,
    put: (c, i, d) => pool.query('insert into docs(col,id,data) values($1,$2,$3) on conflict(col,id) do update set data=$3', [c, i, d]),
    del: (c, i) => pool.query('delete from docs where col=$1 and id=$2', [c, i])
  };
} else {
  const F = path.join(__dirname, 'data.json'); let D = {}, t;
  const save = () => { clearTimeout(t); t = setTimeout(() => fs.writeFileSync(F, JSON.stringify(D)), 200); };
  store = {
    init: async () => { try { D = JSON.parse(fs.readFileSync(F, 'utf8')); } catch { D = {}; } },
    list: async c => Object.entries(D[c] || {}).map(([id, data]) => ({ id, data })),
    get: async (c, i) => (D[c] || {})[i] || null,
    put: async (c, i, d) => { (D[c] = D[c] || {})[i] = d; save(); },
    del: async (c, i) => { if (D[c]) delete D[c][i]; save(); }
  };
}

/* ---------- helpers ---------- */
const send = (res, code, obj, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...h }); res.end(JSON.stringify(obj)); };
const fail = (code, msg) => Object.assign(new Error(msg), { status: code });
const body = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1.5e6) { no(fail(413, 'Too large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(fail(400, 'Bad JSON')); } }); });
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const unsign = t => { const [b, m] = (t || '').split('.'); if (!b || !m) return null; const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); if (m.length !== e.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(e))) return null; try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } };
const cookie = (v, age) => `gl=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${PROD ? '; Secure' : ''}`;
const pub = ({ h, salt, ...r }) => r;
const okId = s => /^[a-z0-9._-]{3,30}$/.test(s), okPin = s => /^\d{4,6}$/.test(String(s));
async function auth(req) {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('gl='));
  const p = unsign(c && c.slice(3)); if (!p) return null;
  const a = await store.get('accounts', p.id); return a ? { id: p.id, name: a.name, team: a.team, role: a.role } : null;
}
async function mkAcc(id, name, pin, team, role) { const salt = crypto.randomBytes(16).toString('hex'); await store.put('accounts', id, { name, team, role, salt, h: hashPin(pin, salt), ts: Date.now() }); }

/* ---------- visibility rules (enforced on the server) ---------- */
const isAdm = u => u.role === 'admin' || u.role === 'super', isGate = u => u.role === 'super' || u.team === 'security';
function see(u, e) {
  if (isGate(u) || e.team === u.team) return true;
  if (u.team === 'dispatch') return e.kind === 'vehicle' && e.purpose === 'Loading';
  if (u.team === 'inward') return e.kind === 'vehicle' && e.purpose === 'Unloading';
  if (u.team === 'hr') return e.kind === 'visitor';
  return false;
}
const strip = (u, e) => { if (isAdm(u) || u.team === 'security') return e; const { contact, meet, ...r } = e; return r; };

/* ---------- auth routes ---------- */
const fails = new Map();
async function login(req, res) {
  const b = await body(req), id = str(b.id, 40).toLowerCase(), ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  const k = ip + '|' + id, f = fails.get(k) || { n: 0, until: 0 };
  if (f.until > Date.now()) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
  const a = await store.get('accounts', id);
  const ok = a && a.h && crypto.timingSafeEqual(Buffer.from(hashPin(b.pin || '', a.salt)), Buffer.from(a.h));
  if (!ok) { f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(k, f); throw fail(401, 'Wrong user ID or PIN.'); }
  fails.delete(k); send(res, 200, { ok: 1 }, { 'set-cookie': cookie(sign({ id, exp: Date.now() + 12 * 3600e3 }), 43200) });
}
async function setup(req, res) {
  const b = await body(req);
  if ((await store.list('accounts')).some(r => r.data.role === 'super')) throw fail(403, 'Already set up');
  if (!SETUP_KEY || b.key !== SETUP_KEY) throw fail(403, 'Wrong setup key');
  const id = str(b.id, 30).toLowerCase(), name = str(b.name, 60);
  if (!name || !okId(id) || !okPin(b.pin)) throw fail(400, 'Enter a name, an ID (3-30 letters/numbers/. _ -) and a PIN of 4 to 6 digits');
  await mkAcc(id, name, b.pin, 'security', 'super'); send(res, 200, { ok: 1 });
}
async function createAcc(req, res, u) {
  if (u.role !== 'super') throw fail(403, 'Only the Super Admin can create users');
  const b = await body(req), id = str(b.id, 30).toLowerCase(), name = str(b.name, 60);
  if (!name || !okId(id) || !okPin(b.pin) || !TEAMS.includes(b.team) || !['member', 'admin'].includes(b.role)) throw fail(400, 'Invalid details');
  if (await store.get('accounts', id)) throw fail(409, 'That user ID already exists');
  await mkAcc(id, name, b.pin, b.team, b.role); send(res, 200, { ok: 1 });
}

/* ---------- generic document API with per-collection rules ---------- */
async function listCol(res, u, col) {
  if (col === 'accounts') return send(res, 200, { docs: (await store.list('accounts')).map(r => ({ id: r.id, data: pub(r.data) })) });
  if (col === 'masters') return send(res, 200, { docs: await store.list('masters') });
  if (col === 'entries') {
    const cut = Date.now() - 31 * DAY;
    const a = (await store.list('entries')).filter(r => r.data.inAt >= cut && see(u, r.data)).sort((x, y) => y.data.inAt - x.data.inAt).slice(0, 1000);
    return send(res, 200, { docs: a.map(r => ({ id: r.id, data: strip(u, r.data) })) });
  }
  throw fail(403, 'Not allowed');
}
async function getDoc(res, u, col, id) {
  const cur = await store.get(col, id);
  if (col === 'accounts') return send(res, 200, { data: cur ? pub(cur) : null });
  if (col === 'masters') return send(res, 200, { data: cur });
  if (col === 'entries') return send(res, 200, { data: cur && see(u, cur) ? strip(u, cur) : null });
  if (col === 'photos') {
    const e = await store.get('entries', id);
    if (!isAdm(u) || (e && !see(u, e))) throw fail(403, 'Only admins can view photos');
    return send(res, 200, { data: cur });
  }
  throw fail(403, 'Not allowed');
}
async function writeDoc(res, u, col, id, op, d) {
  const cur = await store.get(col, id), keys = Object.keys(d || {}), sub = (ks, arr) => ks.every(k => arr.includes(k));
  if (col === 'masters') {
    if (u.role !== 'super') throw fail(403, 'Only the Super Admin can edit these lists');
    if (op === 'delete') await store.del(col, id);
    else await store.put(col, id, { transporters: (d.transporters || []).map(x => str(x, 60)).filter(Boolean).slice(0, 500), routes: (d.routes || []).map(x => str(x, 80)).filter(Boolean).slice(0, 500) });
  } else if (col === 'accounts') {
    if (u.role !== 'super') throw fail(403, 'Only the Super Admin can manage users');
    if (!cur) throw fail(404, 'No such user');
    if (op === 'delete') { if (cur.role === 'super') throw fail(400, 'The Super Admin cannot be removed'); await store.del(col, id); }
    else if (op === 'update') {
      const n = { ...cur };
      if ('role' in d) { if (cur.role === 'super' || !['member', 'admin'].includes(d.role)) throw fail(400, 'Invalid role'); n.role = d.role; }
      if ('team' in d) { if (!TEAMS.includes(d.team)) throw fail(400, 'Invalid team'); n.team = d.team; }
      if ('pin' in d) { if (!okPin(d.pin)) throw fail(400, 'PIN must be 4 to 6 digits'); n.salt = crypto.randomBytes(16).toString('hex'); n.h = hashPin(d.pin, n.salt); }
      await store.put(col, id, n);
    } else throw fail(400, 'Use the create-user form');
  } else if (col === 'entries') {
    if (op === 'set') {
      if (!isGate(u)) throw fail(403, 'Only Security can create entries');
      if (cur) throw fail(409, 'Entry exists');
      const e = { kind: d.kind === 'visitor' ? 'visitor' : 'vehicle', name: str(d.name), company: str(d.company), contact: str(d.contact, 20), vehicleNo: str(d.vehicleNo, 20), pass: str(d.pass, 30), route: str(d.route), purpose: str(d.purpose, 40), meet: str(d.meet), team: TEAMS.includes(d.team) ? d.team : 'security', inAt: Number(d.inAt) || Date.now(), outAt: null, by: u.id };
      if (!e.name || !e.contact) throw fail(400, 'Name and contact are required');
      e.appr = e.kind === 'visitor' ? 'pending' : 'approved';
      await store.put(col, id, e);
    } else if (op === 'update') {
      if (!cur) throw fail(404, 'No such entry');
      if (sub(keys, ['outAt', 'outBy'])) {
        if (!isGate(u)) throw fail(403, 'Only Security can mark out');
        await store.put(col, id, { ...cur, outAt: Number(d.outAt) || Date.now(), outBy: u.id });
      } else if (sub(keys, ['appr', 'apprBy', 'apprName', 'apprAt'])) {
        const may = u.role === 'super' || (u.role === 'admin' && cur.team === u.team);
        if (!may || cur.kind !== 'visitor' || !['approved', 'rejected'].includes(d.appr)) throw fail(403, 'You cannot approve this entry');
        await store.put(col, id, { ...cur, appr: d.appr, apprBy: u.id, apprName: u.name, apprAt: Date.now() });
      } else throw fail(403, 'Not allowed');
    } else if (op === 'delete') { if (u.role !== 'super') throw fail(403, 'Not allowed'); await store.del(col, id); await store.del('photos', id); }
  } else if (col === 'photos') {
    if (op === 'set') {
      if (!isGate(u)) throw fail(403, 'Only Security can add photos');
      if (typeof d.d !== 'string' || !d.d.startsWith('data:image/') || d.d.length > 600000) throw fail(400, 'Invalid photo');
      await store.put(col, id, { d: d.d });
    } else if (op === 'delete') { if (!isAdm(u)) throw fail(403, 'Not allowed'); await store.del(col, id); }
    else throw fail(403, 'Not allowed');
  } else throw fail(403, 'Not allowed');
  send(res, 200, { ok: 1 });
}

/* ---------- router ---------- */
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/shim.js': 'shim.js' };
async function api(req, res, p) {
  const m = req.method, seg = p.split('/').slice(2);
  if (m === 'GET' && p === '/api/status') return send(res, 200, { hasSuper: (await store.list('accounts')).some(r => r.data.role === 'super') });
  if (m === 'POST' && p === '/api/login') return login(req, res);
  if (m === 'POST' && p === '/api/setup') return setup(req, res);
  if (m === 'POST' && p === '/api/logout') return send(res, 200, { ok: 1 }, { 'set-cookie': cookie('', 0) });
  const u = await auth(req); if (!u) throw fail(401, 'Please sign in');
  if (m === 'GET' && p === '/api/me') return send(res, 200, u);
  if (m === 'POST' && p === '/api/accounts') return createAcc(req, res, u);
  if (seg[0] === 'col' && m === 'GET') return listCol(res, u, seg[1]);
  if (seg[0] === 'doc' && seg.length === 3 && /^[\w.~:@+-]{1,64}$/.test(seg[2])) {
    const [, col, id] = seg;
    if (m === 'GET') return getDoc(res, u, col, id);
    if (m === 'DELETE') return writeDoc(res, u, col, id, 'delete', {});
    if (m === 'PUT' || m === 'PATCH') return writeDoc(res, u, col, id, m === 'PUT' ? 'set' : 'update', await body(req));
  }
  throw fail(404, 'Not found');
}
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p.startsWith('/api/')) return await api(req, res, p);
    const f = FILES[p]; if (!f) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': (f.endsWith('.js') ? 'text/javascript' : 'text/html') + '; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', f)));
  } catch (e) { if (!e.status) console.error(e); send(res, e.status || 500, { error: e.status ? e.message : 'Server error' }); }
});

/* 30-day retention: remove entries (and photos) older than 31 days */
async function purge() { const cut = Date.now() - 31 * DAY; for (const r of await store.list('entries')) if (r.data.inAt < cut) { await store.del('entries', r.id); await store.del('photos', r.id); } }
store.init().then(() => { purge().catch(console.error); setInterval(() => purge().catch(console.error), 6 * 3600e3); server.listen(PORT, () => console.log('Sentinel running on port ' + PORT)); });
