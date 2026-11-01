/* Gives the app its storage API, backed by the Sentinel server (polling every 4 s). */
(() => {
  const api = async (m, u, b) => {
    const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: b === undefined ? undefined : JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = r.status; throw e; }
    return j;
  };
  const subs = new Set(), poke = () => subs.forEach(f => f());
  const snap = (id, data) => ({ id, exists: data != null, data: () => data });
  function listen(fetcher, make, empty, next, err) {
    let last = '';
    const run = async () => {
      try { const raw = await fetcher(), k = JSON.stringify(raw); if (k !== last) { last = k; next(make(raw)); } }
      catch (e) {
        if (e.code === 401 || e.code === 403) { if (last !== 'x') { last = 'x'; next(make(empty)); } }
        else if (err && last !== 'E') { last = 'E'; err(e); }
      }
    };
    run(); const t = setInterval(run, 4000); subs.add(run);
    return () => { clearInterval(t); subs.delete(run); };
  }
  const cmp = (a, op, v) => op === '==' ? a === v : op === '!=' ? a !== v : op === '<' ? a < v : op === '<=' ? a <= v : op === '>' ? a > v : op === '>=' ? a >= v : true;
  const col = (name, q = { w: [], o: null, l: 0 }) => {
    const fetchAll = async () => (await api('GET', '/api/col/' + name)).docs;
    const run = raw => {
      let a = raw.slice(); q.w.forEach(([f, op, v]) => { a = a.filter(d => cmp(d.data[f], op, v)); });
      if (q.o) a.sort((x, y) => (x.data[q.o[0]] > y.data[q.o[0]] ? 1 : -1) * (q.o[1] === 'desc' ? -1 : 1));
      if (q.l) a = a.slice(0, q.l);
      return { docs: a.map(d => snap(d.id, d.data)) };
    };
    return {
      where: (f, o, v) => col(name, { ...q, w: [...q.w, [f, o, v]] }),
      orderBy: (f, d) => col(name, { ...q, o: [f, d || 'asc'] }),
      limit: n => col(name, { ...q, l: n }),
      get: async () => run(await fetchAll()),
      onSnapshot: (n, e) => listen(fetchAll, run, [], n, e)
    };
  };
  const doc = p => {
    const [c, i] = p.split('/'), u = `/api/doc/${c}/${i}`, w = async (m, d) => { await api(m, u, d); poke(); };
    return {
      get: async () => snap(i, (await api('GET', u)).data),
      set: d => w('PUT', d), update: d => w('PATCH', d), delete: () => w('DELETE'),
      onSnapshot: (n, e) => listen(async () => (await api('GET', u)).data, d => snap(i, d), null, n, e)
    };
  };
  const DB = { doc, collection: n => col(n) };
  let boot;
  const init = () => boot || (boot = (async () => {
    try { window.STATUS = await api('GET', '/api/status'); } catch (e) { window.STATUS = {}; }
    try { window.ME = await api('GET', '/api/me'); } catch (e) { window.ME = null; }
  })());
  window.claude = {
    use: async n => {
      await init();
      if (n === 'db') return DB;
      if (n === 'user') return { isOwner: async () => true, canEdit: async () => true, id: async () => (window.ME && window.ME.id) || '' };
      return null;
    }
  };
})();
