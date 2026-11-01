const C='pic-v2';
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.webmanifest']))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/')||e.request.method!='GET')return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});
