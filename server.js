// ملك الثعابين - سيرفر الحماية
// الفكرة: السيرفر هو اللي يحسب العملات والجواهر والجوائز ويتأكد من الدفع، واللعبة تعرض النتيجة بس.
// ملك الثعابين - سيرفر الحماية (يشغّل اللعبة نفسها ويحفظ البيانات في Postgres)
// السيرفر هو اللي يحسب العملات والجواهر والجوائز ويتأكد من الدفع، واللعبة تعرض النتيجة بس.
const express = require('express'), { Pool } = require('pg'), crypto = require('crypto'), path = require('path');
const app = express();
app.use(express.json({ limit: '20kb', verify: (req, res, buf) => { req.raw = buf; } }));
app.use((req, res, next) => { // CORS: يلزم بس لو اللعبة مستضافة بمكان ثاني. حط رابطها في ORIGIN
  res.set('Access-Control-Allow-Origin', process.env.ORIGIN || '*');
  res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204); next();
});
app.use(express.static(path.join(__dirname, 'public'))); // اللعبة نفسها (public/index.html)
const url = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, ssl: url && !/localhost|127\.0\.0\.1/.test(url) ? { rejectUnauthorized: false } : false });
const q = (t, a) => pool.query(t, a);
const need = l => 150 + 80 * l, rnd = () => crypto.randomInt(0, 1e6) / 1e4; // رقم عشوائي من السيرفر 0..100
const now = () => Date.now();
const NEW = () => ({ xp: 0, lv: 1, co: 0, gm: 0, sx: 0, bx: 0, pm: 0, bf: 0, bq: 0, ow: {}, ms: null, sb: {} });
const A = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'server' }); });

// حد للطلبات: 60 طلب بالدقيقة لكل لاعب
const hits = new Map(); setInterval(() => hits.clear(), 60000);
async function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', ''), { rows } = await q('select * from players where token=$1', [t]);
    if (!rows[0]) return res.status(401).json({ error: 'auth' });
    const n = (hits.get(rows[0].id) || 0) + 1; hits.set(rows[0].id, n); if (n > 60) return res.status(429).json({ error: 'slow' });
    req.p = rows[0]; req.s = rows[0].state; next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
}
const save = req => q('update players set state=$1::jsonb where id=$2', [JSON.stringify(req.s), req.p.id]);
const addxp = (s, n) => { s.xp += n; while (s.xp >= need(s.lv)) { s.xp -= need(s.lv); s.lv++; } };

// ---- السكنات (نفس ترتيب اللعبة) ----
const LV = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30,32,35]; // سكنات اللفل: رقم السكن -> اللفل
const REG = [29,30,26,27,31,32,22,23,24,25], RARE = [17,18,19,20,21,28,33], LEG = [35,36,37,38,39];
const own = (s, i) => !!s.ow[i] || (i < LV.length && s.lv >= LV[i]);
const pick = (s, P) => { const q = P.filter(i => !own(s, i)); return q.length ? q[crypto.randomInt(q.length)] : null; };
const gsk = (s, P, cc) => { const i = pick(s, P); if (i == null) { s.co += cc; return 'سكن مكرر -> ' + cc + ' عملة'; } s.ow[i] = 1; return 'سكن #' + i; };

// ---- الجوائز والبكجات ----
function give(s, r) {
  const [t, n] = r;
  if (t === 'p') return give(s, n === 2 ? roll(O2) : n === 1 ? roll(O1, 1) : roll(O0));
  if (t === 'xc') { addxp(s, n); s.co += r[2]; return n + ' خبرة و' + r[2] + ' عملة'; }
  if (t === 'x') { addxp(s, n); return n + ' خبرة'; }
  if (t === 'c') { s.co += n; return n + ' عملة'; }
  if (t === 'g') { s.gm += n; return n + ' جوهرة'; }
  if (t === 's') { if (n == null) return gsk(s, REG, 50); if (own(s, n)) { s.co += 50; return 'سكن مكرر -> 50 عملة'; } s.ow[n] = 1; return 'سكن #' + n; }
  if (t === 'r') return gsk(s, RARE, 150);
  if (t === 'rr') return gsk(s, RARE, 150) + ' + ' + gsk(s, RARE, 150);
  if (t === 'rs') return gsk(s, RARE, 150) + ' + ' + gsk(s, REG, 50);
  if (t === 'l') return gsk(s, LEG, 500);
  if (t === 'lc') { s.co += n; return gsk(s, LEG, 500) + ' + ' + n + ' عملة'; }
  if (t === 'lv') { s.xp = need(s.lv); addxp(s, 0); return 'زيادة مستوى'; }
  if (t === 'rm') { s.sx++; if (n) addxp(s, n); return 'تذكرة الغرفة الخاصة'; }
  if (t === 'ph') { if (s.ow[34]) { s.co += 2000; return 'العنقاء مكررة -> 2000 عملة'; } s.ow[34] = 1; return 'العنقاء'; }
  return '';
}
function roll(T, fb) { const r = rnd(); let a = 0; for (const e of T) { a += e[0]; if (r < a) return e[1]; } return T[fb || 0][1]; }
const O0 = [[30,['x',40]],[17,['c',15]],[10,['x',80]],[12,['c',30]],[30,['c',5]],[1,['r']]];
const O2 = [[15,['c',350]],[8,['c',600]],[7,['xc',400,300]],[20,['s']],[5,['rs']],[15,['r']],[20,['x',300]],[3,['l']],[5,['xc',500,400]],[0.634,['rm',0]],[1,['p',1]]];
const O1 = [[20,['rr']],[20,['c',1700]],[20,['x',2000]],[15,['l']],[7,['lc',400]],[8,['p',2]],[3,['lv']],[2,['rm',700]],[0.0267,['ph']]];
const PACKS = { normal: [5, O0, 0], legendary: [10, O2, 0], mythic: [20, O1, 1] };

app.get('/api/ping', (req, res) => res.json({ ok: 1 }));
app.post('/api/register', A(async (req, res) => {
  const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString('hex');
  await q('insert into players(id,token,state) values($1,$2,$3::jsonb)', [id, token, JSON.stringify(NEW())]); res.json({ id, token });
}));
app.get('/api/me', auth, (req, res) => res.json(req.s));

// نهاية المباراة: السيرفر يحسب الخبرة والجواهر ويرفض الأرقام الغير منطقية
app.post('/api/match', auth, A(async (req, res) => {
  const b = req.body, s = req.s, t = now(), secs = Math.min(+b.secs || 0, 3600), ate = +b.ate || 0, kills = +b.kills || 0, maxlen = +b.maxlen || 10, top = +b.top || 0;
  if (t - Number(req.p.last_match) < 20000) return res.status(429).json({ error: 'too_fast' });
  if (secs < 5 || ate > secs * 6 || kills > secs / 8 || maxlen > 10 + ate * 0.6 + kills * 40 || top > secs) return res.status(400).json({ error: 'suspicious' });
  const gems = Math.min(Math.floor((maxlen - 10) / 200) + 3 * Math.floor(top / 180), Math.floor(secs / 45));
  s.gm += gems; s.bx += ate + kills * 25 + Math.floor(secs / 10) + (maxlen >> 2); addxp(s, ate + (maxlen >> 1) + kills * 40);
  const d = new Date().toISOString().slice(0, 10); if (!s.ms || s.ms.d !== d) s.ms = { d, p: [0, 0, 0], c: [0, 0, 0] };
  s.ms.p[0] += ate; s.ms.p[1] += kills; s.ms.p[2] = Math.max(s.ms.p[2], maxlen);
  await q('update players set last_match=$1 where id=$2', [t, req.p.id]); await save(req); res.json({ gems, state: s });
}));

app.post('/api/pack', auth, A(async (req, res) => { // فتح بكج: السيرفر يخصم الجواهر ويسحب الجائزة بنفسه
  const k = PACKS[req.body.type]; if (!k) return res.status(400).json({ error: 'type' });
  if (req.s.gm < k[0]) return res.status(402).json({ error: 'gems' });
  req.s.gm -= k[0]; const r = roll(k[1], k[2]), text = give(req.s, r); await save(req); res.json({ reward: r, text, state: req.s });
}));
const SKIN_COIN = { 22: 250, 23: 350, 24: 450, 25: 600, 28: 800, 33: 700, 37: 1500, 38: 1200 }; // سكنات بالعملات
app.post('/api/skin', auth, A(async (req, res) => {
  const i = +req.body.idx, p = SKIN_COIN[i]; if (!p || own(req.s, i)) return res.status(400).json({ error: 'skin' });
  if (req.s.co < p) return res.status(402).json({ error: 'coins' }); req.s.co -= p; req.s.ow[i] = 1; await save(req); res.json({ state: req.s });
}));
const MS = [[150, 40], [3, 60], [60, 50]];
app.post('/api/mission', auth, A(async (req, res) => {
  const i = +req.body.i, m = req.s.ms; if (!MS[i] || !m || m.c[i] || m.p[i] < MS[i][0]) return res.status(400).json({ error: 'mission' });
  m.c[i] = 1; req.s.co += MS[i][1]; req.s.bx += 100; await save(req); res.json({ state: req.s });
}));
// جوائز الباتل باس
const FR = { 10: ['s', 29], 25: ['s', 30], 30: ['g', 5] }, PR = { 3: ['s', 26], 9: ['s', 27], 15: ['s', 28], 21: ['s', 31], 30: ['s', 33], 39: ['s', 32], 12: ['g', 5], 23: ['g', 5], 33: ['g', 5], 43: ['g', 5], 45: ['g', 10] };
[2,4,6,8,12,14,16,18,20,22].forEach(l => FR[l] = ['c', 7]); [3,7,15,19,23].forEach(l => FR[l] = ['x', 30]);
[1,4,8,11,17,20,26,32,37,40].forEach(l => PR[l] = ['c', 280]); [2,7,13,18,24,28,35,41].forEach(l => PR[l] = ['x', 400]);
app.post('/api/pass', auth, A(async (req, res) => {
  const s = req.s, pl = Math.min(45, Math.floor(s.bx / 100)), out = [];
  for (let l = s.bf + 1; l <= Math.min(pl, 30); l++) if (FR[l]) out.push(give(s, FR[l])); s.bf = Math.max(s.bf, Math.min(pl, 30));
  if (s.pm) { for (let l = s.bq + 1; l <= pl; l++) if (PR[l]) out.push(give(s, PR[l])); s.bq = Math.max(s.bq, pl); }
  await save(req); res.json({ got: out, state: s });
}));
// الغرفة الخاصة: السيرفر يتأكد إنك مؤهل ويحط سقف 2500 عملة
app.post('/api/stage', auth, A(async (req, res) => {
  const s = req.s, k = req.body.k, c = Math.min(Math.max(+req.body.c || 0, 0), 2500); s.sb = s.sb || {};
  const ok = k === 'tk' ? s.sx > 0 : k === 'l30' ? s.lv >= 30 : k === 'pp' ? (s.pm && Math.floor(s.bx / 100) >= 45) : false;
  if (!ok) return res.status(400).json({ error: 'stage' });
  const pv = k === 'tk' ? 0 : (s.sb[k] || 0); if (k === 'tk') s.sx--; s.co += Math.max(0, c - pv); if (k !== 'tk') s.sb[k] = Math.max(pv, c);
  await save(req); res.json({ state: s });
}));

// ---- الدفع بالريال (الأسعار هنا بالسيرفر، مو باللعبة) ----
const SKU = { coins100: [4, s => { s.co += 100; }], coins500: [10, s => { s.co += 500; }], pass_premium: [20, s => { s.pm = 1; }],
  skin_phoenix: [20, s => { s.ow[34] = 1; }], skin_aurora: [18, s => { s.ow[35] = 1; }], skin_thunder: [16, s => { s.ow[36] = 1; }], skin_gold: [12, s => { s.ow[39] = 1; }] };
async function createCheckout(order) {
  // TODO: استدعِ بوابة الدفع (مُيسّر / Tap / Stripe) وارجع { url } لصفحة الدفع، وخلّ رابط الرجوع يكون رابط اللعبة + ?paid=1
  // وحط order.id في بيانات الطلب عند البوابة عشان ترجعه لنا في الويب هوك
  throw new Error('اربط بوابة الدفع هنا');
}
app.post('/api/checkout', auth, A(async (req, res) => {
  const k = SKU[req.body.sku]; if (!k) return res.status(400).json({ error: 'sku' });
  const o = { id: crypto.randomUUID(), player: req.p.id, sku: req.body.sku, amount: k[0] };
  await q('insert into orders values($1,$2,$3,$4,$5,$6)', [o.id, o.player, o.sku, o.amount, 'pending', now()]);
  try { res.json({ url: (await createCheckout(o)).url }); } catch (e) { res.status(501).json({ error: 'payment_not_configured' }); }
}));
app.post('/api/webhook', A(async (req, res) => { // البوابة تنادي هنا بعد الدفع. غيّر فحص التوقيع حسب وثائق بوابتك
  const sig = String(req.headers['x-signature'] || ''), ok = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET || 'change-me').update(req.raw || '').digest('hex');
  if (sig.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok))) return res.sendStatus(401);
  const { rows: [o] } = await q('select * from orders where id=$1', [req.body.order_id]);
  if (!o || o.status === 'paid' || req.body.status !== 'paid' || +req.body.amount !== Number(o.amount)) return res.sendStatus(400); // يرفض المكرر والمبلغ الغلط
  const { rows: [r] } = await q('select * from players where id=$1', [o.player]), s = r.state; SKU[o.sku][1](s);
  await q('update players set state=$1::jsonb where id=$2', [JSON.stringify(s), o.player]); await q("update orders set status='paid' where id=$1", [o.id]); res.sendStatus(200);
}));
(async () => {
  await q(`create table if not exists players(id text primary key, token text unique, state jsonb, last_match bigint default 0);
create table if not exists orders(id text primary key, player text, sku text, amount numeric, status text, created bigint);`);
  app.listen(process.env.PORT || 3000, () => console.log('server up'));
})().catch(e => { console.error(e); process.exit(1); });
