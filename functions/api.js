/**
 * 泥研製所 零用金記帳 App — Cloudflare Pages Function
 * 取代原本的 Google Apps Script 後端，改讀寫 D1。
 * 路由：POST /api   （前端 API_URL 設為 '/api'）
 * D1 綁定名稱：DB（與 niyan-db 共用，資料表為 petty_cash_records）
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = JSON.parse(await request.text()); } catch (_) {}
  const action = body.action || 'getAll';
  const payload = body.payload || {};
  try {
    const data = await handle(env.DB, action, payload);
    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

/* ---------- 工具 ---------- */
function json(o) {
  return new Response(JSON.stringify(o), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function tw(offsetSlice) {              // 台灣時間
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, offsetSlice).replace('T', ' ');
}
const now = () => tw(19);               // yyyy-MM-dd HH:mm:ss
function numOrNull(v) { return (v === '' || v == null) ? null : Number(v); }

/* ---------- 分派 ---------- */
async function handle(DB, action, p) {
  switch (action) {
    case 'getAll':         return getAll(DB);
    case 'append':          return append(DB, p.record || {});
    case 'submitLunch':     return submitLunch(DB, p.ledger || []);
    case 'deleteRecords':   return deleteRecords(DB, p.targets || []);
    case 'saveCount':       return saveCount(DB, p.count || {});
    case 'deleteCount':     return deleteCount(DB, p.date || '');
    case 'submitLunchOrders': return submitLunchOrders(DB, p.orders || []);
    case 'deleteLunchOrders': return deleteLunchOrders(DB, p);
    case 'addLunchPayment':   return addLunchPayment(DB, p.payment || {});
    case 'deleteLunchPayment':return deleteLunchPayment(DB, p.id);
    default: throw new Error('unknown action: ' + action);
  }
}

/* ---------- 讀取 ---------- */
async function getAll(DB) {
  const res = await DB.prepare(
    'SELECT id,date,item,type,income,expense,handler FROM petty_cash_records ORDER BY id ASC'
  ).all();
  const records = (res.results || []).map(r => ({
    row: r.id,
    date: r.date,
    item: r.item,
    type: r.type,
    income: r.income == null ? '' : r.income,
    expense: r.expense == null ? '' : r.expense,
    handler: r.handler || '',
  }));
  return { records, counts: await readCounts(DB), ...(await readLunch(DB)) };
}

/* ---------- 每日現金清點 ---------- */
const DENOMS = [1000, 500, 100, 50, 10, 5, 1];

// 清點表若還沒建好(遠端 D1 尚未套用 schema),不要讓整個 getAll 掛掉
async function readCounts(DB) {
  try {
    const res = await DB.prepare(
      'SELECT * FROM petty_cash_counts ORDER BY date DESC LIMIT 90'
    ).all();
    return (res.results || []).map(r => ({
      date: r.date,
      denoms: DENOMS.reduce((o, d) => (o[d] = r['n' + d] || 0, o), {}),
      counted: Number(r.counted || 0),
      book: Number(r.book || 0),
      diff: Number(r.diff || 0),
      handler: r.handler || '',
      note: r.note || '',
      updated_at: r.updated_at || r.created_at || '',
    }));
  } catch (_) {
    return [];
  }
}

async function saveCount(DB, c) {
  const date = String(c.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('清點日期格式不對');
  const src = c.denoms || {};
  const n = {};
  let counted = 0;
  for (const d of DENOMS) {
    const qty = Math.max(0, Math.trunc(Number(src[d] || 0)) || 0);
    n[d] = qty;
    counted += d * qty;              // 金額一律後端重算,不信前端送來的總額
  }
  const book = Number(c.book || 0);
  const diff = counted - book;
  const ts = now();
  await DB.prepare(
    `INSERT INTO petty_cash_counts
       (date,n1000,n500,n100,n50,n10,n5,n1,counted,book,diff,handler,note,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET
       n1000=excluded.n1000, n500=excluded.n500, n100=excluded.n100, n50=excluded.n50,
       n10=excluded.n10, n5=excluded.n5, n1=excluded.n1,
       counted=excluded.counted, book=excluded.book, diff=excluded.diff,
       handler=excluded.handler, note=excluded.note, updated_at=excluded.updated_at`
  ).bind(
    date, n[1000], n[500], n[100], n[50], n[10], n[5], n[1],
    counted, book, diff, c.handler || '', c.note || '', ts, ts
  ).run();
  return { ok: true, date, counted, book, diff };
}

async function deleteCount(DB, date) {
  const d = String(date || '').slice(0, 10);
  if (!d) throw new Error('缺少清點日期');
  await DB.prepare('DELETE FROM petty_cash_counts WHERE date=?').bind(d).run();
  return { ok: true, date: d };
}

/* ---------- 餐費(2026-10-02 起與零用金分離) ---------- */
// 點餐只記在 lunch_orders / lunch_payments,完全不碰 petty_cash_records。
// 資料表若還沒建好,整包回空陣列,不要讓 getAll 掛掉。
async function readLunch(DB) {
  const empty = { lunchOrders: [], lunchPayments: [], lunchTotals: [] };
  try {
    const o = await DB.prepare(
      `SELECT id,date,person,item,less_rice,price,handler,created_at
         FROM lunch_orders
        WHERE date >= date('now','+8 hours','-180 day')
        ORDER BY date DESC, id DESC`
    ).all();
    const p = await DB.prepare(
      `SELECT id,date,person,amount,note,handler,created_at
         FROM lunch_payments ORDER BY date DESC, id DESC`
    ).all();
    // 每人累計「應付/已繳」一律在後端算全期間,前端不必抓全部明細
    const t = await DB.prepare(
      `SELECT person, SUM(ordered) AS ordered, SUM(paid) AS paid FROM (
         SELECT person, SUM(price)  AS ordered, 0 AS paid FROM lunch_orders   GROUP BY person
         UNION ALL
         SELECT person, 0, SUM(amount)         FROM lunch_payments GROUP BY person
       ) GROUP BY person ORDER BY person`
    ).all();
    return {
      lunchOrders: (o.results || []).map(r => ({
        id: r.id, date: r.date, person: r.person, item: r.item,
        lessRice: !!r.less_rice, price: Number(r.price || 0),
        handler: r.handler || '', created_at: r.created_at || '',
      })),
      lunchPayments: (p.results || []).map(r => ({
        id: r.id, date: r.date, person: r.person, amount: Number(r.amount || 0),
        note: r.note || '', handler: r.handler || '', created_at: r.created_at || '',
      })),
      lunchTotals: (t.results || []).map(r => ({
        person: r.person,
        ordered: Number(r.ordered || 0),
        paid: Number(r.paid || 0),
        owed: Number(r.ordered || 0) - Number(r.paid || 0),
      })),
    };
  } catch (_) {
    return empty;
  }
}

async function submitLunchOrders(DB, orders) {
  const list = Array.isArray(orders) ? orders : [];
  if (!list.length) return { ok: true, count: 0 };
  const ts = now();
  const stmts = list.map(o => DB.prepare(
    'INSERT INTO lunch_orders (date,person,item,less_rice,price,handler,created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(
    String(o.date || '').slice(0, 10),
    String(o.person || '').trim(),
    String(o.item || '').trim(),
    o.lessRice ? 1 : 0,
    Number(o.price || 0),
    o.handler || '', ts
  ));
  await DB.batch(stmts);
  return { ok: true, count: list.length };
}

async function deleteLunchOrders(DB, p) {
  const ids = (p.ids || []).map(Number).filter(n => Number.isFinite(n));
  if (ids.length) {
    await DB.batch(ids.map(id => DB.prepare('DELETE FROM lunch_orders WHERE id=?').bind(id)));
    return { ok: true, deleted: ids.length };
  }
  const date = String(p.date || '').slice(0, 10);
  const person = String(p.person || '').trim();
  if (!date || !person) throw new Error('缺少刪除條件');
  const res = await DB.prepare('DELETE FROM lunch_orders WHERE date=? AND person=?')
    .bind(date, person).run();
  return { ok: true, deleted: (res.meta && res.meta.changes) || 0 };
}

async function addLunchPayment(DB, pay) {
  const date = String(pay.date || '').slice(0, 10);
  const person = String(pay.person || '').trim();
  const amount = Number(pay.amount || 0);
  if (!date || !person) throw new Error('缺少日期或姓名');
  if (!(amount > 0)) throw new Error('金額要大於 0');
  await DB.prepare(
    'INSERT INTO lunch_payments (date,person,amount,note,handler,created_at) VALUES (?,?,?,?,?,?)'
  ).bind(date, person, amount, pay.note || '', pay.handler || '', now()).run();
  return { ok: true };
}

async function deleteLunchPayment(DB, id) {
  const n = Number(id);
  if (!Number.isFinite(n)) throw new Error('缺少收款紀錄 id');
  await DB.prepare('DELETE FROM lunch_payments WHERE id=?').bind(n).run();
  return { ok: true };
}

/* ---------- 寫入 ---------- */
async function insertOne(DB, rec) {
  const type = rec.type || (rec.income ? '收入' : '支出');
  await DB.prepare(
    'INSERT INTO petty_cash_records (date,item,type,income,expense,handler,created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(
    rec.date || '', rec.item || '', type,
    numOrNull(rec.income), numOrNull(rec.expense), rec.handler || '', now()
  ).run();
}

async function append(DB, record) {
  await insertOne(DB, record);
  return { ok: true };
}

// 舊版前端(分頁還沒重新整理)仍會呼叫 submitLunch 並送來零用金格式的 ledger。
// 餐錢自 2026-10-02 起不扣零用金,所以這裡一律改寫進 lunch_orders。
async function submitLunch(DB, ledger) {
  const orders = (Array.isArray(ledger) ? ledger : []).map(r => {
    const raw = String(r.item || '');
    let person = '', label = raw, lessRice = 0;
    const m = raw.match(/^(.+?)\s*[\u2014\u2013-]\s*(.+?)\s*[\u2014\u2013-]\s*\u4fbf\u7576\s*$/);
    if (m) { person = m[1].trim(); label = m[2].trim(); }
    else {
      const t = raw.match(/^(.+?)\s*[\u2014\u2013-]\s*(.+)$/);
      if (t) { person = t[1].trim(); label = t[2].trim(); }
    }
    const lr = label.match(/^(.*?)\s*[(\uff08]\s*\u5c11\u98ef\s*[)\uff09]\s*$/);
    if (lr) { label = lr[1].trim(); lessRice = 1; }
    return {
      date: r.date, person, item: label, lessRice,
      price: Number(r.expense || 0), handler: r.handler || '',
    };
  }).filter(o => o.person && o.item);
  return submitLunchOrders(DB, orders);
}

/* ---------- 刪除 ---------- */
async function deleteRecords(DB, targets) {
  const ids = (targets || [])
    .map(t => Number(t.row))
    .filter(n => Number.isFinite(n));
  if (!ids.length) return { ok: true, deleted: 0 };
  const stmts = ids.map(id => DB.prepare('DELETE FROM petty_cash_records WHERE id=?').bind(id));
  await DB.batch(stmts);
  return { ok: true, deleted: ids.length };
}
