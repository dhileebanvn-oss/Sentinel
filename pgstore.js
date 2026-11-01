'use strict';
/* Optional Postgres storage for PI Verify. Active only when DATABASE_URL is set (see start.js).
   The app keeps working on local files; this module restores them from Postgres at start-up and
   mirrors every change back to Postgres within ~1.5 s. Set DB_SCHEMA to share one database with other apps. */
const fs = require('fs'), path = require('path');
const url = process.env.DATABASE_URL;
const schema = (process.env.DB_SCHEMA || '').replace(/[^a-zA-Z0-9_]/g, '');
if (!process.env.DB_FILE) process.env.DB_FILE = '/tmp/piverify/data.json';   // local cache only
const DB = process.env.DB_FILE, SF = DB.replace(/\.json$/, '') + '.stock.json', JF = DB.replace(/\.json$/, '') + '.journal';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: url, ssl: /render\.com/.test(url) || process.env.PGSSL === 'on' ? { rejectUnauthorized: false } : false, max: 3 });
if (schema) pool.on('connect', c => c.query('set search_path to ' + schema + ', public'));
const q = (s, a) => pool.query(s, a);
const last = { cfg: '', stock: '', cfgM: 0, stockM: 0, ino: null, off: 0 };
let busy = false;

async function restore() {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  if (schema) await q('create schema if not exists ' + schema);
  await q('create table if not exists kv(k text primary key, v text not null)');
  await q('create table if not exists jchunks(seq bigserial primary key, v text not null)');
  const kv = {}; (await q('select k,v from kv')).rows.forEach(r => kv[r.k] = r.v);
  const j = (await q('select v from jchunks order by seq')).rows.map(r => r.v).join('');
  for (const f of [DB, SF, JF]) { try { fs.unlinkSync(f); } catch (e) {} }   // local files are only a cache
  if (kv.cfg) { fs.writeFileSync(DB, kv.cfg); last.cfg = kv.cfg; }
  if (kv.stock) { fs.writeFileSync(SF, kv.stock); last.stock = kv.stock; }
  if (j) { fs.writeFileSync(JF, j); last.ino = fs.statSync(JF).ino; }
  last.off = Buffer.byteLength(j);
  console.log('[pgstore] restored from Postgres: config=' + !!kv.cfg + ' stock=' + !!kv.stock + ' journal=' + last.off + ' bytes');
}

async function sync() {
  if (busy) return; busy = true;
  try {
    for (const [name, f] of [['cfg', DB], ['stock', SF]]) {
      let st; try { st = fs.statSync(f); } catch (e) { continue; }
      if (st.mtimeMs === last[name + 'M']) continue;
      const t = fs.readFileSync(f, 'utf8'); last[name + 'M'] = st.mtimeMs;
      if (t !== last[name]) { await q('insert into kv(k,v) values($1,$2) on conflict(k) do update set v=$2', [name, t]); last[name] = t; }
    }
    let st = null; try { st = fs.statSync(JF); } catch (e) {}
    if (st) {
      if ((last.ino !== null && st.ino !== last.ino) || st.size < last.off) {      // journal rewritten (stock upload / reset)
        const t = fs.readFileSync(JF, 'utf8'), body = t.slice(0, t.lastIndexOf('\n') + 1);
        const c = await pool.connect();
        try { await c.query('begin'); await c.query('delete from jchunks'); if (body) await c.query('insert into jchunks(v) values($1)', [body]); await c.query('commit'); }
        catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
        last.ino = st.ino; last.off = Buffer.byteLength(body);
      } else if (st.size > last.off) {                                              // normal append
        const fd = fs.openSync(JF, 'r'), buf = Buffer.alloc(st.size - last.off);
        fs.readSync(fd, buf, 0, buf.length, last.off); fs.closeSync(fd);
        const cut = buf.lastIndexOf(10) + 1;
        if (cut) { await q('insert into jchunks(v) values($1)', [buf.slice(0, cut).toString('utf8')]); last.off += cut; }
        last.ino = st.ino;
      }
    } else if (last.off) { await q('delete from jchunks'); last.off = 0; last.ino = null; }
  } catch (e) { console.error('[pgstore] sync failed:', e.message); }
  busy = false;
}

async function start() {
  await restore();                       // if this fails the app does not start (it never runs on empty data by mistake)
  setInterval(sync, 1500);
  global.PGFLUSH = async () => { while (busy) await new Promise(r => setTimeout(r, 50)); await sync(); };
}
module.exports = { start };
