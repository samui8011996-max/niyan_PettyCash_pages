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
  return { records };
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

async function submitLunch(DB, ledger) {
  const list = Array.isArray(ledger) ? ledger : [];
  for (const rec of list) await insertOne(DB, rec);
  return { ok: true, count: list.length };
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
