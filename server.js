// PI Verify server v1.1 (zero dependencies). Run: node server.js | first login MASTER / 1234
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const VER='1.3.0',PORT=process.env.PORT||3000,DB=process.env.DB_FILE||path.join(__dirname,'data.json'),PUB=path.join(__dirname,'public');
const SF=DB.replace(/\.json$/,'')+'.stock.json',JF=DB.replace(/\.json$/,'')+'.journal';
let D={sites:[],users:[],stock:[],scans:[],bins:[],ls:{},done:{},req:{},up:{},tokens:{},xl:{}};
const rf=f=>{try{return JSON.parse(fs.readFileSync(f))}catch(e){return null}};
const c0=rf(DB)||{};Object.assign(D,c0);const s0=rf(SF);if(s0)D.stock=s0;
const legacy=(c0.scans&&c0.scans.length)||(c0.stock&&c0.stock.length&&!s0),seen=new Set();let jq=[],cfgDirty=0;
try{fs.readFileSync(JF,'utf8').split('\n').forEach(l=>{if(!l)return;const e=JSON.parse(l);if(e.k=='s'){D.scans.push(e.v);seen.add(e.v.cid)}else if(e.k=='b')D.bins.push(e.v);else if(e.k=='d')D.done[e.key]=e.u})}catch(e){}
const wf=(f,s)=>{fs.writeFileSync(f+'.tmp',s);fs.renameSync(f+'.tmp',f)};
const wrCfg=()=>wf(DB,JSON.stringify({sites:D.sites,users:D.users,ls:D.ls,req:D.req,up:D.up,tokens:D.tokens,xl:D.xl}));
function persistAll(){wf(SF,JSON.stringify(D.stock));const L=[];D.scans.forEach(v=>L.push(JSON.stringify({k:'s',v})));D.bins.forEach(v=>L.push(JSON.stringify({k:'b',v})));Object.keys(D.done).forEach(key=>L.push(JSON.stringify({k:'d',key,u:D.done[key]})));wf(JF,L.join('\n')+(L.length?'\n':''));jq=[];wrCfg();cfgDirty=0}
const J=o=>jq.push(JSON.stringify(o)),save=()=>{cfgDirty=1};
const flushDb=()=>{if(jq.length){fs.appendFileSync(JF,jq.join('\n')+'\n');jq=[]}if(cfgDirty){cfgDirty=0;wrCfg()}};
setInterval(flushDb,1000);['SIGINT','SIGTERM'].forEach(s=>process.on(s,()=>{flushDb();const f=global.PGFLUSH;(f?Promise.race([f(),new Promise(r=>setTimeout(r,5000))]):Promise.resolve()).then(()=>process.exit(),()=>process.exit())}));
const hash=(p,s)=>crypto.scryptSync(String(p),s,32).toString('hex');
const mkU=(id,name,pin,role,site)=>{const salt=crypto.randomBytes(8).toString('hex');return{id,name,role,site,salt,h:hash(pin,salt)}};
if(!D.users.length){D.users.push(mkU('MASTER','Master Admin','1234','master','ALL'));save()}
let LI={},SK=new Set(),PL={},LT={},AG=new Map();
const agl=(site,l,p)=>{const k=l+'\t'+p;let x=AG.get(k);if(!x){x={site,loc:l,part:p,sys:0,rs:{},by:'',t1:0,t2:0};AG.set(k,x)}return x};
const agAdd=s=>{const x=agl(s.site,s.loc,s.part),t=Date.parse(s.t)||Date.parse(s.st)||0;x.rs[s.round]=(x.rs[s.round]||0)+s.q;x.by=s.u;if(!x.t1||t<x.t1)x.t1=t;if(t>x.t2)x.t2=t};
const idx=()=>{LI={};SK=new Set();PL={};LT={};AG=new Map();D.stock.forEach(r=>{LI[r.loc]=r.site;if(r.lot>1&&!LT[r.site+'\t'+r.part])LT[r.site+'\t'+r.part]=r.lot;SK.add(r.loc+'\t'+r.part);if(!PL[r.site+'\t'+r.part])PL[r.site+'\t'+r.part]=r.loc;agl(r.site,r.loc,r.part).sys+=r.qty});D.scans.forEach(s=>{if(s.audit=='perp')agAdd(s)})};idx();const siteOf=l=>LI[l]||D.xl[l],lotOf=(st,p)=>LT[st+'\t'+p]||1;
D.scans.forEach(s=>seen.add(s.cid));if(legacy)persistAll();
const up=s=>String(s||'').trim().toUpperCase(),K=(...a)=>a.join('\t'),uname=id=>(D.users.find(u=>u.id==id)||{}).name||id;
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const send=(r,c,o,h)=>{r.writeHead(c,Object.assign({'Content-Type':typeof o=='string'?'text/plain':'application/json'},h||{}));r.end(typeof o=='string'?o:JSON.stringify(o))};
const rd=q=>new Promise(ok=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch(e){ok({})}})});
const csv=(h,rows)=>[h].concat(rows).map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
const clients=new Set();let pt=0;const push=()=>{if(pt)return;pt=setTimeout(()=>{pt=0;clients.forEach(r=>r.write('data: 1\n\n'))},3000)};
const cache=new Map(),bust=()=>cache.clear();
function cached(key,ttl,fn){const c=cache.get(key);if(c&&Date.now()-c.t<ttl)return c.p;const p=new Promise(ok=>{const j=JSON.stringify(fn());if(j.length<1024)return ok({j,gz:null});zlib.gzip(j,(e,gz)=>ok({j,gz:e?null:gz}))});cache.set(key,{t:Date.now(),p});return p}
async function sendC(req,res,pe){const e=await pe;const g=e.gz&&/gzip/.test(req.headers['accept-encoding']||'');res.writeHead(200,Object.assign({'Content-Type':'application/json'},g?{'Content-Encoding':'gzip'}:{}));res.end(g?e.gz:e.j)}
function lines(ok,uid){const out=[];AG.forEach(x=>{if(!ok(x.site)||(uid&&x.by!=uid))return;const n=Math.max(0,...Object.keys(x.rs).map(Number)),r=[];for(let i=1;i<=n;i++)r.push(x.rs[i]||0);if(uid&&!r.length)return;const y={loc:x.loc,part:x.part,sys:uid?0:x.sys,r};if(x.by){y.by=x.by;y.t1=x.t1;y.t2=x.t2}if(D.req[K(x.loc,x.part)])y.req=1;{const lt=LT[x.site+'\t'+x.part];if(lt>1)y.lot=lt}out.push(y)});return out}
function state(me){const mst=me.role=='master',cn=me.role=='counter',ok=s=>mst||s==me.site,LOCS={},LP={},LB={};
D.stock.forEach(r=>{if(ok(r.site))LOCS[r.loc]=r.site});Object.keys(D.xl).forEach(l=>{if(ok(D.xl[l]))LOCS[l]=D.xl[l]});const LOT={};if(cn)Object.keys(LT).forEach(k=>{const i=k.indexOf('\t');if(k.slice(0,i)==me.site)LOT[k.slice(i+1)]=LT[k]});Object.keys(D.ls).forEach(k=>{const[a,l]=k.split('|');if(LOCS[l])(a=='perp'?LP:LB)[l]=D.ls[k].st});
const Dl=lines(ok,cn?me.id:null);
const B=D.bins.filter(b=>ok(b.site)&&(!cn||b.u==me.id)).map(b=>{const ex=SK.has(b.loc+'\t'+b.part);return{loc:b.loc,part:b.part,ok:ex?1:0,sl:ex?'':PL[b.site+'\t'+b.part]||'',by:b.u,t:Date.parse(b.t)||0}});
const upd={};Object.keys(D.up).forEach(s=>{if(ok(s))upd[s]=D.up[s]});
return{me:{id:me.id,name:me.name,role:me.role,site:me.site},sites:D.sites.filter(s=>ok(s.code)),users:cn?[]:D.users.filter(u=>mst||u.site==me.site).map(u=>({id:u.id,name:u.name,role:u.role,site:u.site})),LOCS,LP,LB,D:Dl,B,up:upd,LOT,ver:VER}}
function sync(me,items){const now=new Date().toISOString();(items||[]).forEach(i=>{if(!i.cid||(i.u&&i.u!=me.id))return;
const loc=up(i.loc),part=up(i.part),a=i.type=='bscan'||i.audit=='bin'?'bin':'perp',L=D.ls[a+'|'+loc];
if(me.role!='counter'||siteOf(loc)!=me.site||!L||L.st!='In progress'||L.by!=me.id)return;const r_=D.req[K(loc,part)]||1;
if(i.type=='scan'&&a=='perp'){if(seen.has(i.cid)||D.done[K(loc,part,r_)]||(L.rc&&!D.req[K(loc,part)])||!Number.isFinite(+i.q))return;seen.add(i.cid);const v={cid:i.cid,site:me.site,loc,part,q:+i.q*lotOf(me.site,part),packs:+i.q,lot:lotOf(me.site,part),u:me.id,n:me.name,t:i.t||now,st:now,audit:'perp',round:r_};D.scans.push(v);J({k:'s',v});agAdd(v)}
else if(i.type=='done'&&a=='perp'){D.done[K(loc,part,r_)]=me.id;delete D.req[K(loc,part)];J({k:'d',key:K(loc,part,r_),u:me.id});save()}
else if(i.type=='bscan'){if(!D.bins.some(b=>b.loc==loc&&b.part==part)){const v={site:me.site,loc,part,u:me.id,n:me.name,t:i.t||now};D.bins.push(v);J({k:'b',v})}}
else if(i.type=='close'){L.st='Closed';L.cb=me.id;L.by='';save();cache.delete('c:'+me.id)}
else if(i.type=='pause'){L.by='';save()}});push()}
function purge(s,keepStock){const locs=new Set(D.stock.filter(r=>r.site==s).map(r=>r.loc).concat(Object.keys(D.xl).filter(l=>D.xl[l]==s)));Object.keys(D.xl).forEach(l=>{if(D.xl[l]==s)delete D.xl[l]});D.scans=D.scans.filter(x=>x.site!=s);D.bins=D.bins.filter(x=>x.site!=s);
Object.keys(D.ls).forEach(k=>{if(locs.has(k.split('|')[1]))delete D.ls[k]});[D.done,D.req].forEach(o=>Object.keys(o).forEach(k=>{if(locs.has(k.split('\t')[0]))delete o[k]}));
if(!keepStock){D.stock=D.stock.filter(r=>r.site!=s);delete D.up[s]}seen.clear();D.scans.forEach(x=>seen.add(x.cid))}
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x'),p=u.pathname;
if(!p.startsWith('/api/')){const f=path.resolve(PUB,'.'+(p=='/'?'/index.html':p));if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return send(res,404,'Not found');res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});return fs.createReadStream(f).pipe(res)}
if(p=='/api/version')return send(res,200,{ver:VER});
if(p=='/api/login'&&req.method=='POST'){const b=await rd(req),x=D.users.find(x=>x.id==up(b.id));if(!x||hash(b.pin,x.salt)!=x.h)return send(res,401,{error:'Invalid user ID or PIN'});const t=crypto.randomBytes(24).toString('hex');D.tokens[t]=x.id;const ks=Object.keys(D.tokens);if(ks.length>500)delete D.tokens[ks[0]];save();return send(res,200,{token:t})}
const me=D.users.find(x=>x.id==D.tokens[(req.headers.authorization||'').slice(7)||u.searchParams.get('t')]);if(!me)return send(res,401,{error:'auth'});
const mst=me.role=='master',cn=me.role=='counter',okS=s=>mst||s==me.site,E=(c,m)=>send(res,c,{error:m}),OK=()=>send(res,200,{ok:1});
if(p=='/api/state')return sendC(req,res,cn?cached('c:'+me.id,4000,()=>state(me)):cached('a:'+me.role+':'+me.site,3000,()=>state(me)));
if(p=='/api/sync'&&req.method=='POST'){sync(me,(await rd(req)).items);return OK()}
if(p=='/api/start'){const b=await rd(req),loc=up(b.loc),a=b.audit=='bin'?'bin':'perp';
if(!cn)return E(403,'counters only');if(!loc)return E(400,'Enter or scan a location.');const own=siteOf(loc);if(own&&own!=me.site)return E(409,'Location '+loc+' belongs to another site ('+own+').');let extra=false;if(!own){D.xl[loc]=me.site;extra=true;save()}else if(!LI[loc])extra=true;
const k=a+'|'+loc,L=D.ls[k];let rc=false;
if(L&&L.st=='In progress'&&L.by&&L.by!=me.id)return E(409,'Location in use by '+uname(L.by));
if(L&&L.st=='Closed'){rc=a=='perp'&&Object.keys(D.req).some(x=>x.split('\t')[0]==loc);if(!rc)return E(409,'Location '+loc+' is already closed. Ask your admin to request a recount.')}
D.ls[k]={st:'In progress',by:me.id,rc:rc||(L&&L.rc)||false};save();push();
const sm={};if(a=='perp')D.scans.forEach(s=>{if(s.loc==loc&&s.audit=='perp'){(sm[s.part]=sm[s.part]||{})[s.round]=((sm[s.part]||{})[s.round]||0)+s.q}});
const done=[];let cur=null,n=0;Object.keys(sm).forEach(pt_=>{const r=D.req[K(loc,pt_)]||1,c=sm[pt_][r];if(c===undefined)return;if(D.done[K(loc,pt_,r)])done.push([pt_,c]);else{cur=pt_;n=c}});
return send(res,200,{done,cur,n,extra,only:rc?Object.keys(D.req).filter(x=>x.split('\t')[0]==loc).map(x=>x.split('\t')[1]):null})}
if(p=='/api/export/scans'){if(cn)return E(403,'admin only');const rows=D.scans.filter(s=>okS(s.site)).map(s=>[s.site,s.t,s.u,s.n,s.loc,s.part,'Perpetual R'+s.round,s.q,s.lot||1,s.packs!=null?s.packs:s.q]).concat(D.bins.filter(b=>okS(b.site)).map(b=>[b.site,b.t,b.u,b.n,b.loc,b.part,'Bin-face','','','']));
return send(res,200,csv(['Site','Date Time','User ID','User Name','Location','Part','Audit','Qty','Lot size','Packs scanned'],rows),{'Content-Disposition':'attachment; filename=scan_log.csv','Content-Type':'text/csv'})}
if(p=='/api/findpart'){const q=up(u.searchParams.get('q'));if(!q)return E(400,'Enter or scan a part number.');const ok=x=>mst||x==me.site,hit=[];
AG.forEach(x=>{if(x.part==q&&x.sys>0&&ok(x.site)){const n=Math.max(0,...Object.keys(x.rs).map(Number)),f=n?x.rs[n]||0:0;hit.push({loc:x.loc,rank:n?(f<x.sys?0:2):1,gap:x.sys-f})}});
hit.sort((a,b)=>a.rank-b.rank||b.gap-a.gap);const sg=[];if(!hit.length){const sn=new Set();for(const x of AG.values()){if(x.sys>0&&ok(x.site)&&x.part!=q&&x.part.includes(q)&&!sn.has(x.part)){sn.add(x.part);sg.push(x.part);if(sg.length>=5)break}}}
return send(res,200,{q,res:hit.slice(0,8).map(h=>({loc:h.loc,rank:h.rank})),more:Math.max(0,hit.length-8),sg})}
if(p=='/api/mypin'){const b=await rd(req);if(hash(b.old,me.salt)!=me.h)return E(400,'Current PIN is wrong');if(String(b.pin||'').length<4)return E(400,'New PIN needs at least 4 characters');me.salt=crypto.randomBytes(8).toString('hex');me.h=hash(b.pin,me.salt);save();return OK()}
if(p=='/api/backup'){if(!mst)return E(403,'master only');return send(res,200,JSON.stringify(D),{'Content-Disposition':'attachment; filename=pi_verify_backup.json','Content-Type':'application/json'})}
if(p=='/api/pause')return OK();
if(cn)return E(403,'admin only');
if(p=='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write('data: 1\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
const b=await rd(req);bust();
if(p=='/api/site'){if(!mst)return E(403,'master only');const c=String(b.code||'').trim();if(!/^\d{3,6}$/.test(c))return E(400,'Site code must be 3 to 6 digits.');if(D.sites.some(s=>s.code==c))return E(400,'Site '+c+' already exists.');D.sites.push({code:c,name:String(b.name||'').trim()});save();return OK()}
if(p=='/api/users'){const id=up(b.id).replace(/[^A-Z0-9_.-]/g,''),role=b.role=='site'&&mst?'site':'counter',site=mst?String(b.site):me.site;
if(!id||!b.name)return E(400,'Enter a user ID and a name.');if(String(b.pin||'').length<4)return E(400,'PIN must be at least 4 characters.');if(D.users.some(x=>x.id==id))return E(400,'User ID '+id+' already exists.');if(!D.sites.some(s=>s.code==site))return E(400,'Choose a valid site.');
D.users.push(mkU(id,String(b.name),b.pin,role,site));save();return OK()}
if(p=='/api/users/pin'||p=='/api/users/delete'){const x=D.users.find(y=>y.id==up(b.id));if(!x||!okS(x.site)||(!mst&&x.role!='counter'))return E(403,'Not allowed');
if(p.endsWith('pin')){if(String(b.pin||'').length<4)return E(400,'PIN min 4');x.salt=crypto.randomBytes(8).toString('hex');x.h=hash(b.pin,x.salt)}else{if(x.id==me.id)return E(400,'Cannot delete yourself');D.users=D.users.filter(y=>y!=x)}save();return OK()}
if(p=='/api/stock'){const s=mst?String(b.site||''):me.site;if(!D.sites.some(x=>x.code==s))return E(400,'Unknown site code');const rows=[];
String(b.csv||'').replace(/^\uFEFF/,'').split(/\r?\n/).forEach(l=>{const c=l.split(/[,\t;]/).map(x=>x.trim().replace(/^"|"$/g,'')),q=parseFloat(c[2]);const lt=c[3]===undefined||c[3]===''?1:parseFloat(c[3]);if(c.length>=3&&!isNaN(q)&&c[0]&&c[1]&&lt>0){const r={site:s,loc:up(c[0]),part:up(c[1]),qty:q};if(lt!=1)r.lot=lt;rows.push(r)}});
if(!rows.length)return E(400,'No valid rows. Format: Location,Part,Qty');const bad=rows.find(r=>siteOf(r.loc)&&siteOf(r.loc)!=s);if(bad)return E(400,'Location '+bad.loc+' already belongs to site '+siteOf(bad.loc));
purge(s,false);D.stock=D.stock.concat(rows);D.up[s]={name:String(b.name||'upload').slice(0,80),t:Date.now(),by:me.name,n:rows.length};idx();persistAll();push();return send(res,200,{rows:rows.length})}
if(p=='/api/reset'){const s=mst?String(b.site||''):me.site;if(!D.sites.some(x=>x.code==s))return E(400,'Unknown site code');purge(s,b.kind!='stock');idx();persistAll();push();return OK()}
if(p=='/api/recount-all'){const s=mst?String(b.site||'ALL'):me.site,ok_=x=>s=='ALL'||x==s;let c=0;lines(ok_,false).forEach(x=>{const L=D.ls['perp|'+x.loc];if(!L||L.st!='Closed'||D.req[K(x.loc,x.part)])return;const n=x.r.length,f=n?x.r[n-1]:0;if(f==x.sys||n>=3)return;D.req[K(x.loc,x.part)]=n?n+1:2;c++});save();push();return send(res,200,{count:c})}
if(p=='/api/release'){const L=D.ls[(b.audit=='bin'?'bin':'perp')+'|'+up(b.loc)];if(L&&okS(siteOf(up(b.loc)))){L.by='';save();push()}return OK()}
E(404,'not found')}).listen(PORT,()=>console.log('PI Verify running on http://localhost:'+PORT+'  (first login MASTER / 1234)'));
