'use strict';

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

const ALLOWED_PLANS = new Set(['basic', 'pro', 'premium']);

/** Prefer header, then request context/user, then default. */
function getTenantId(req) {
  return (
    req.headers['x-tenant-id'] ||
    req.context?.tenantId ||
    req.user?.tenantId ||
    DEFAULT_TENANT_ID
  );
}

/** In-memory fallback so the page still works without DB tables. */
const MEMORY_TENANTS = new Map();
function defaultMemoryTenant(id) {
  return {
    id,
    name: 'Organization',
    status: 'trial',
    plan_code: 'basic',
    trial_ends_at: null,
    auto_disable_overdue: false,
    grace_days: 7,
    billing_email: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Plan defaults; feature flags can override these. */
const PLAN_DEFAULTS = {
  basic:   { savings: true, loans: true, collections: true, accounting: true, sms: false, esignatures: false, payroll: false, investors: true, assets: true, collateral: true },
  pro:     { savings: true, loans: true, collections: true, accounting: true, sms: true,  esignatures: true,  payroll: true,  investors: true, assets: true, collateral: true },
  premium: { savings: true, loans: true, collections: true, accounting: true, sms: true,  esignatures: true,  payroll: true,  investors: true, assets: true, collateral: true },
};

const isPgMissingTable = (e) =>
  e?.original?.code === '42P01' || e?.parent?.code === '42P01';

/** Fetch tenant row from DB (or null if none / table missing). */
async function fetchTenant(tenantId) {
  try {
    const rows = await sequelize.query(
      `select * from public.tenants where id = :id limit 1`,
      { replacements: { id: tenantId }, type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  } catch (e) {
    if (isPgMissingTable(e)) return null;
    throw e;
  }
}

/** Upsert a simple tenant row if table exists. Silently no-op if table missing. */
async function ensureProvisioned(tenantId) {
  try {
    await sequelize.query(
      `insert into public.tenants (id, name, status, plan_code, created_at, updated_at)
       values (:id, :name, 'trial', 'basic', now(), now())
       on conflict (id) do nothing`,
      { replacements: { id: tenantId, name: 'Organization' } }
    );
  } catch (e) {
    if (!isPgMissingTable(e)) throw e;
  }
}

/** Sanitize PATCH body */
function cleanPatch(body = {}) {
  const out = {};
  if (typeof body.name === 'string') out.name = body.name.trim();
  if (typeof body.planCode === 'string') {
    const p = body.planCode.toLowerCase();
    if (ALLOWED_PLANS.has(p)) out.planCode = p;
  }
  if (typeof body.status === 'string') out.status = body.status.trim();

  if (body.trialEndsAt === '' || body.trialEndsAt === null) {
    out.trialEndsAt = null;
  } else if (typeof body.trialEndsAt === 'string') {
    const d = Date.parse(body.trialEndsAt);
    if (!Number.isNaN(d)) out.trialEndsAt = body.trialEndsAt.slice(0, 10);
  }

  if (typeof body.autoDisableOverdue === 'boolean')
    out.autoDisableOverdue = body.autoDisableOverdue;

  if (Number.isFinite(Number(body.graceDays))) {
    const g = Math.max(0, Math.min(90, Number(body.graceDays)));
    out.graceDays = g;
  }

  if (typeof body.billingEmail === 'string')
    out.billingEmail = body.billingEmail.trim();

  return out;
}

/** Convert row -> API response shape expected by frontend */
function toResponseShape(row) {
  const today = new Date().toISOString().slice(0, 10);
  const trialLeft =
    row?.trial_ends_at
      ? Math.ceil(
          (Date.parse(row.trial_ends_at) - Date.parse(today)) / 86400000
        )
      : null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    planCode: (row.plan_code || 'basic').toLowerCase(),
    trialEndsAt: row.trial_ends_at,
    trialDaysLeft: trialLeft,
    autoDisableOverdue: !!row.auto_disable_overdue,
    graceDays: Number.isFinite(Number(row.grace_days)) ? Number(row.grace_days) : 7,
    billingEmail: row.billing_email || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

exports.me = async (req, res, next) => {
  const id = getTenantId(req);
  try {
    await ensureProvisioned(id);
    const dbTenant = await fetchTenant(id);
    if (dbTenant) return res.json(toResponseShape(dbTenant));

    // Fallback to memory if table missing or not yet created
    const mem = MEMORY_TENANTS.get(id) || defaultMemoryTenant(id);
    MEMORY_TENANTS.set(id, mem);
    return res.json(toResponseShape(mem));
  } catch (e) {
    if (isPgMissingTable(e)) {
      const mem = MEMORY_TENANTS.get(id) || defaultMemoryTenant(id);
      MEMORY_TENANTS.set(id, mem);
      return res.json(toResponseShape(mem));
    }
    return next(e);
  }
};

exports.updateMe = async (req, res, next) => {
  const id = getTenantId(req);
  const patch = cleanPatch(req.body || {});
  try {
    // Attempt DB update first
    const q = [];
    const rep = { id };

    if ('name' in patch)       { q.push(`name = :name`); rep.name = patch.name; }
    if ('planCode' in patch)   { q.push(`plan_code = :planCode`); rep.planCode = patch.planCode; }
    if ('status' in patch)     { q.push(`status = :status`); rep.status = patch.status; }
    if ('trialEndsAt' in patch){ q.push(`trial_ends_at = :trialEndsAt`); rep.trialEndsAt = patch.trialEndsAt; }
    if ('autoDisableOverdue' in patch) { q.push(`auto_disable_overdue = :autoDisableOverdue`); rep.autoDisableOverdue = patch.autoDisableOverdue; }
    if ('graceDays' in patch)  { q.push(`grace_days = :graceDays`); rep.graceDays = patch.graceDays; }
    if ('billingEmail' in patch){ q.push(`billing_email = :billingEmail`); rep.billingEmail = patch.billingEmail; }

    if (q.length > 0) {
      await sequelize.query(
        `update public.tenants
           set ${q.join(', ')}, updated_at = now()
         where id = :id`,
        { replacements: rep }
      );
    }

    const t = await fetchTenant(id);
    if (t) return res.json({ ok: true, tenant: toResponseShape(t) });

    // If table missing, fall back to memory
    throw Object.assign(new Error('tenants table missing'), { code: '42P01' });
  } catch (e) {
    if (isPgMissingTable(e)) {
      const cur = MEMORY_TENANTS.get(id) || defaultMemoryTenant(id);
      const next = { ...cur };

      if ('name' in patch) next.name = patch.name;
      if ('planCode' in patch) next.plan_code = patch.planCode;
      if ('status' in patch) next.status = patch.status;
      if ('trialEndsAt' in patch) next.trial_ends_at = patch.trialEndsAt;
      if ('autoDisableOverdue' in patch) next.auto_disable_overdue = patch.autoDisableOverdue;
      if ('graceDays' in patch) next.grace_days = patch.graceDays;
      if ('billingEmail' in patch) next.billing_email = patch.billingEmail;
      next.updated_at = new Date().toISOString();

      MEMORY_TENANTS.set(id, next);
      return res.json({ ok: true, tenant: toResponseShape(next) });
    }
    return next(e);
  }
};

exports.entitlements = async (req, res, next) => {
  const id = getTenantId(req);
  try {
    const dbTenant = await fetchTenant(id);
    const plan = (dbTenant?.plan_code || 'basic').toLowerCase();
    const base = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.basic;

    // Try to read feature flag overrides; ignore if table missing.
    let overrides = {};
    try {
      const rows = await sequelize.query(
        `select key, enabled from public.feature_flags where tenant_id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      overrides = Object.fromEntries(rows.map((r) => [r.key, !!r.enabled]));
    } catch (e) {
      if (!isPgMissingTable(e)) throw e;
    }

    const modules = { ...base, ...overrides };
    return res.json({ modules, planCode: plan, status: dbTenant?.status || 'trial' });
  } catch (e) {
    if (isPgMissingTable(e)) {
      const mem = MEMORY_TENANTS.get(id) || defaultMemoryTenant(id);
      const plan = (mem.plan_code || 'basic').toLowerCase();
      return res.json({ modules: { ...PLAN_DEFAULTS[plan] }, planCode: plan, status: mem.status || 'trial' });
    }
    return next(e);
  }
};

/* ------------------------- NEW: limits & invoices -------------------------- */

exports.getLimits = async (req, res, next) => {
  const id = getTenantId(req);
  try {
    const rows = await sequelize.query(
      `select key, value_int, value_numeric, value_text, value_json
         from public.tenant_limits where tenant_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    const obj = {};
    for (const r of rows) {
      const v = r.value_int ?? (r.value_numeric != null ? Number(r.value_numeric)
                : (r.value_text ?? r.value_json ?? null));
      obj[r.key] = v;
    }
    return res.json(obj);
  } catch (e) {
    if (isPgMissingTable(e)) return res.json({});
    return next(e);
  }
};

exports.setLimits = async (req, res, next) => {
  const id = getTenantId(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const entries = Object.entries(body);
  if (!entries.length) return res.json({ ok: true, limits: {} });

  try {
    const values = [];
    for (const [key, val] of entries) {
      let vi=null, vn=null, vt=null, vj=null;
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (Number.isInteger(val)) vi = val; else vn = val;
      } else if (typeof val === 'string') vt = val;
      else vj = JSON.stringify(val);
      values.push({ key, vi, vn, vt, vj });
    }

    const chunks = values.map((_, i) => `(:id,:k${i},:vi${i},:vn${i},:vt${i},:vj${i},now(),now())`);
    const repl = { id };
    values.forEach((v, i) => {
      repl[`k${i}`]  = v.key;
      repl[`vi${i}`] = v.vi;
      repl[`vn${i}`] = v.vn;
      repl[`vt${i}`] = v.vt;
      repl[`vj${i}`] = v.vj;
    });

    await sequelize.query(`
      insert into public.tenant_limits
        (tenant_id,key,value_int,value_numeric,value_text,value_json,created_at,updated_at)
      values ${chunks.join(',')}
      on conflict (tenant_id,key) do update set
        value_int=excluded.value_int,
        value_numeric=excluded.value_numeric,
        value_text=excluded.value_text,
        value_json=excluded.value_json,
        updated_at=now()
    `, { replacements: repl });

    return exports.getLimits(req, res, next);
  } catch (e) {
    if (isPgMissingTable(e)) return res.json({});
    return next(e);
  }
};

exports.listInvoices = async (req, res, next) => {
  const id = getTenantId(req);
  try {
    const rows = await sequelize.query(
      `select id, number, amount_cents, currency, status, due_date, issued_at, paid_at
         from public.invoices
        where tenant_id = :id
        order by coalesce(issued_at, created_at) desc
        limit 250`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    return res.json(rows);
  } catch (e) {
    if (isPgMissingTable(e)) return res.json([]);
    return next(e);
  }
};

/* ------------------------------- Billing cron ------------------------------ */
exports.cronCheck = async (_req, res, next) => {
  try {
    try {
      await sequelize.query(`
        with past_due as (
          select i.tenant_id, t.grace_days, min(i.due_date) as first_due
          from public.invoices i
          join public.tenants t on t.id = i.tenant_id
          where i.status in ('open','past_due')
            and (i.due_date + (t.grace_days || ' days')::interval) < now()
          group by 1,2
        )
        update public.tenants t
           set status = 'suspended', updated_at = now()
          from past_due p
         where t.id = p.tenant_id
           and t.auto_disable_overdue = true
           and t.status <> 'suspended';
      `);
    } catch (e) { if (!isPgMissingTable(e)) throw e; }

    try {
      await sequelize.query(`
        update public.tenants
           set status = 'suspended', updated_at = now()
         where status = 'trial'
           and trial_ends_at is not null
           and trial_ends_at < current_date;
      `);
    } catch (e) { if (!isPgMissingTable(e)) throw e; }

    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) { next(e); }
};

/* -------------------- optional backward-compatible aliases ----------------- */
exports.limits    = exports.getLimits;
exports.invoices  = exports.listInvoices;
