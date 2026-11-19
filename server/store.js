// Tiny key-value layer: Upstash Redis over its REST API in production,
// an in-memory map (optionally saved to .data/dev-store.json) for local dev.

import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const usingRedis = !!(URL_ && TOKEN);

async function redis(cmds) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`Redis: ${r.error}`);
    return r.result;
  });
}

// ── memory fallback ──
const DEV_FILE = path.join(process.cwd(), '.data', 'dev-store.json');
let mem = null;
function memory() {
  if (!mem) {
    mem = new Map();
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(DEV_FILE, 'utf8')))) mem.set(k, v); } catch {}
  }
  return mem;
}
function saveMem() {
  if (process.env.VERCEL) return;
  try {
    fs.mkdirSync(path.dirname(DEV_FILE), { recursive: true });
    fs.writeFileSync(DEV_FILE, JSON.stringify(Object.fromEntries(memory())));
  } catch {}
}

const parse = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return s; } };

export async function get(key) {
  if (!usingRedis) return parse(memory().get(key) ?? null);
  const [v] = await redis([['GET', key]]);
  return parse(v);
}

export async function mget(keys) {
  if (!keys.length) return [];
  if (!usingRedis) return keys.map((k) => parse(memory().get(k) ?? null));
  const [vals] = await redis([['MGET', ...keys]]);
  return vals.map(parse);
}

export async function set(key, value) {
  if (!usingRedis) { memory().set(key, JSON.stringify(value)); saveMem(); return; }
  await redis([['SET', key, JSON.stringify(value)]]);
}

export async function del(key) {
  if (!usingRedis) { memory().delete(key); saveMem(); return; }
  await redis([['DEL', key]]);
}

export async function incr(key) {
  if (!usingRedis) { const n = Number(memory().get(key) || 0) + 1; memory().set(key, String(n)); saveMem(); return n; }
  const [n] = await redis([['INCR', key]]);
  return n;
}

export async function lists(keys) {
  if (!keys.length) return [];
  if (!usingRedis) return keys.map((k) => (parse(memory().get(k)) || []).map(parse));
  const out = await redis(keys.map((k) => ['LRANGE', k, '0', '-1']));
  return out.map((l) => (l || []).map(parse));
}

// Append only if the list still has `expectedLen` items — makes simultaneous picks safe.
const PUSH_IF_LEN = "if redis.call('LLEN', KEYS[1]) == tonumber(ARGV[1]) then return redis.call('RPUSH', KEYS[1], ARGV[2]) else return -1 end";
export async function pushIfLen(key, expectedLen, value) {
  if (!usingRedis) {
    const l = parse(memory().get(key)) || [];
    if (l.length !== expectedLen) return false;
    l.push(JSON.stringify(value));
    memory().set(key, JSON.stringify(l));
    saveMem();
    return true;
  }
  const [r] = await redis([['EVAL', PUSH_IF_LEN, '1', key, String(expectedLen), JSON.stringify(value)]]);
  return r !== -1;
}

export async function pop(key) {
  if (!usingRedis) {
    const l = parse(memory().get(key)) || [];
    const v = l.pop();
    memory().set(key, JSON.stringify(l));
    saveMem();
    return parse(v ?? null);
  }
  const [v] = await redis([['RPOP', key]]);
  return parse(v);
}

// Replace the item at `index` in a list.
export async function setAt(key, index, value) {
  if (!usingRedis) {
    const l = parse(memory().get(key)) || [];
    if (index < 0 || index >= l.length) return false;
    l[index] = JSON.stringify(value);
    memory().set(key, JSON.stringify(l));
    saveMem();
    return true;
  }
  await redis([['LSET', key, String(index), JSON.stringify(value)]]);
  return true;
}
