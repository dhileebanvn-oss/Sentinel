'use strict';
/* Start-up: restore data from Postgres first (when DATABASE_URL is set), then run the app. */
(async () => {
  if (process.env.DATABASE_URL) {
    try { await require('./pgstore').start(); }
    catch (e) { console.error('[pgstore] cannot start:', e); process.exit(1); }
  }
  require('./server.js');
})();
