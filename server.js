// 光东工作台 · 轻量同步后端代理
// 作用：持有飞书自建应用的 App Secret（仅环境变量），转发读写飞书多维表格「同步存储」表。
// 前端只持有本服务的地址，绝不接触 App Secret。
// 无第三方依赖，使用 Node 内置 http + 全局 fetch（Node 18+）。

const http = require('http');

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN; // 多维表格 Base 的 app_token
const SYNC_TABLE_NAME = process.env.SYNC_TABLE_NAME || '同步存储';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const SYNC_KEY = process.env.SYNC_KEY || ''; // 可选：前端需在 x-sync-key 头带上
const PORT = process.env.PORT || 3000;

const B_BASE = 'https://open.feishu.cn/open-apis/bitable/v1';
const AUTH_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';

let tokenCache = null;
let tokenExp = 0;

function fail(res, code, msg, extra) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: msg, ...(extra || {}) }));
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function getToken() {
  if (tokenCache && Date.now() < tokenExp) return tokenCache;
  if (!APP_ID || !APP_SECRET) throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET');
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + j.msg);
  tokenCache = j.tenant_access_token;
  tokenExp = Date.now() + (j.expire - 60) * 1000;
  return tokenCache;
}

async function feishu(path, method, body) {
  const token = await getToken();
  const r = await fetch(B_BASE + path, {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('飞书接口错误(' + j.code + '): ' + j.msg);
  return j;
}

async function ensureSyncTable() {
  const j = await feishu(`/apps/${BASE_TOKEN}/tables`);
  const items = (j.data && j.data.items) || [];
  const found = items.find((t) => t.name === SYNC_TABLE_NAME);
  if (found) return found.table_id;
  throw new Error(
    `未在多维表格中找到名为「${SYNC_TABLE_NAME}」的表。请在飞书中新建一个表，命名为「${SYNC_TABLE_NAME}」，并含两列：版本(数字)、数据(多行文本/文本)，然后把应用加为可编辑协作者。`
  );
}

async function getSyncRow(tid) {
  const j = await feishu(`/apps/${BASE_TOKEN}/tables/${tid}/records?page_size=10`);
  const items = (j.data && j.data.items) || [];
  return items[0] || null; // 始终维护单行快照
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-sync-key');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // 可选密钥校验
  if (SYNC_KEY && req.headers['x-sync-key'] !== SYNC_KEY) {
    fail(res, 401, 'sync_key 校验失败');
    return;
  }

  try {
    if (p === '/health' || p === '/') {
      send(res, 200, { ok: true, service: 'gd-sync', table: SYNC_TABLE_NAME });
      return;
    }

    if (p === '/api/sync') {
      if (req.method === 'GET') {
        const tid = await ensureSyncTable();
        const row = await getSyncRow(tid);
        if (!row) {
          send(res, 200, { version: 0, data: '' });
          return;
        }
        send(res, 200, { version: num(row.fields.version), data: row.fields.data || '' });
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        for await (const c of req) body += c;
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          fail(res, 400, '请求体不是合法 JSON');
          return;
        }
        const baseVersion = num(parsed.baseVersion);
        const dataStr = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data || {});

        const tid = await ensureSyncTable();
        const row = await getSyncRow(tid);
        const curVersion = row ? num(row.fields.version) : 0;

        if (curVersion !== baseVersion) {
          // 版本不一致 → 冲突，返回当前云端状态让前端决策
          fail(res, 409, 'conflict', { current: { version: curVersion, data: row ? row.fields.data || '' : '' } });
          return;
        }

        const newVersion = curVersion + 1;
        if (row) {
          await feishu(`/apps/${BASE_TOKEN}/tables/${tid}/records/${row.record_id}`, 'PUT', {
            fields: { version: newVersion, data: dataStr },
          });
        } else {
          await feishu(`/apps/${BASE_TOKEN}/tables/${tid}/records`, 'POST', {
            fields: { version: newVersion, data: dataStr },
          });
        }
        send(res, 200, { version: newVersion });
        return;
      }
    }

    fail(res, 404, 'not found');
  } catch (e) {
    fail(res, 502, '后端错误: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`gd-sync listening on :${PORT} | base=${BASE_TOKEN} table=${SYNC_TABLE_NAME}`);
});
