import { promises as fs } from "fs";
import path from "path";
import postgres from "postgres";
import { DEFAULT_RULES } from "@/lib/default-rules";
import type { OrderGroup, ParsingRule } from "@/types";

type LocalStore = {
  rules: ParsingRule[];
  orders: OrderGroup[];
};

const storePath = process.env.VERCEL
  ? path.join("/tmp", "universal-order-importer-store.json")
  : path.join(process.cwd(), "data", "local-store.json");

let sqlClient: ReturnType<typeof postgres> | null = null;

function withDefaultRules(rules: ParsingRule[]) {
  const seen = new Set(rules.map((rule) => rule.id));
  return [...rules, ...DEFAULT_RULES.filter((rule) => !seen.has(rule.id))];
}

function getSql() {
  if (!process.env.DATABASE_URL) return null;
  sqlClient ||= postgres(process.env.DATABASE_URL, { max: 3 });
  return sqlClient;
}

async function readLocal(): Promise<LocalStore> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    return JSON.parse(raw) as LocalStore;
  } catch {
    return { rules: [], orders: [] };
  }
}

async function writeLocal(store: LocalStore) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

export async function ensureSchema() {
  const sql = getSql();
  if (!sql) return;
  await sql`
    create table if not exists parsing_rules (
      id text primary key,
      name text not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists imported_orders (
      id text primary key,
      external_code text,
      recipient_name text,
      store_name text,
      submitted_at timestamptz not null,
      payload jsonb not null
    )
  `;
}

export async function listRules(): Promise<ParsingRule[]> {
  const sql = getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql<{ payload: ParsingRule }[]>`select payload from parsing_rules order by updated_at desc`;
    return withDefaultRules(rows.map((row) => row.payload));
  }
  const rules = (await readLocal()).rules;
  return withDefaultRules(rules);
}

export async function saveRule(rule: ParsingRule) {
  const sql = getSql();
  const updatedRule = { ...rule, updatedAt: new Date().toISOString() };
  if (sql) {
    await ensureSchema();
    await sql`
      insert into parsing_rules (id, name, payload, created_at, updated_at)
      values (${updatedRule.id}, ${updatedRule.name}, ${sql.json(updatedRule)}, ${updatedRule.createdAt}, ${updatedRule.updatedAt})
      on conflict (id) do update set
        name = excluded.name,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `;
    return updatedRule;
  }
  const store = await readLocal();
  const index = store.rules.findIndex((item) => item.id === updatedRule.id);
  if (index >= 0) store.rules[index] = updatedRule;
  else store.rules.unshift(updatedRule);
  await writeLocal(store);
  return updatedRule;
}

export async function deleteRule(id: string) {
  const sql = getSql();
  if (sql) {
    await ensureSchema();
    await sql`delete from parsing_rules where id = ${id}`;
    return;
  }
  const store = await readLocal();
  store.rules = store.rules.filter((rule) => rule.id !== id);
  await writeLocal(store);
}

export async function listOrders(params: { query?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const sql = getSql();
  if (sql) {
    await ensureSchema();
    const query = `%${params.query || ""}%`;
    const rows = await sql<{ payload: OrderGroup; total: number }[]>`
      select payload, count(*) over()::int as total
      from imported_orders
      where (${params.query || ""} = '' or external_code ilike ${query} or recipient_name ilike ${query} or store_name ilike ${query})
        and (${params.from || ""} = '' or submitted_at >= ${params.from || "1970-01-01"}::timestamptz)
        and (${params.to || ""} = '' or submitted_at <= ${params.to || "2999-01-01"}::timestamptz)
      order by submitted_at desc
      limit ${pageSize}
      offset ${(page - 1) * pageSize}
    `;
    return { items: rows.map((row) => row.payload), total: rows[0]?.total || 0 };
  }

  const store = await readLocal();
  let items = store.orders;
  if (params.query) {
    const q = params.query.toLowerCase();
    items = items.filter((item) =>
      [item.externalCode, item.recipientName, item.storeName].some((value) => String(value || "").toLowerCase().includes(q))
    );
  }
  if (params.from) items = items.filter((item) => (item.submittedAt || "") >= params.from!);
  if (params.to) items = items.filter((item) => (item.submittedAt || "") <= params.to!);
  const total = items.length;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total };
}

export async function existingExternalCodes() {
  const sql = getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql<{ external_code: string }[]>`select external_code from imported_orders where external_code is not null`;
    return rows.map((row) => row.external_code).filter(Boolean);
  }
  const store = await readLocal();
  return store.orders.map((order) => order.externalCode).filter(Boolean) as string[];
}

export async function saveOrders(orders: OrderGroup[]) {
  const submittedAt = new Date().toISOString();
  const normalized = orders.map((order) => ({ ...order, submittedAt }));
  const sql = getSql();
  if (sql) {
    await ensureSchema();
    for (const order of normalized) {
      await sql`
        insert into imported_orders (id, external_code, recipient_name, store_name, submitted_at, payload)
        values (${order.id}, ${order.externalCode || null}, ${order.recipientName || null}, ${order.storeName || null}, ${submittedAt}, ${sql.json(order)})
        on conflict (id) do update set payload = excluded.payload, submitted_at = excluded.submitted_at
      `;
    }
    return normalized;
  }
  const store = await readLocal();
  store.orders.unshift(...normalized);
  await writeLocal(store);
  return normalized;
}
