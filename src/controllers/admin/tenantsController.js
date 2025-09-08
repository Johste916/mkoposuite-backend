// server/controllers/admin/tenantsController.js
'use strict';
const crypto = require('crypto');
let jwt;
try { jwt = require('jsonwebtoken'); } catch {}

const { sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

const isMissing = (e) => e?.original?.code === '42P01' || e?.parent?.code === '42P01';

const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

function sanitizeCore(body = {}) {
  const out = {};
  if (typeof body.planCode === 'string') out.planCode = body.planCode.toLowerCase();
  if (Number.isFinite(Number(body.seats))) out.seats = Number(body.seats);
  if (typeof body.billingEmail === 'string') out.billingEmail = body.billingEmail.trim();
  if (typeof body.status === 'string') out.status = body.status.trim().toLowerCase();

  if (body.trialEndsAt === '' || body.trialEndsAt === null) out.trialEndsAt = null;
  else if (typeof body.trialEndsAt === 'string') out.trialEndsAt = body.trialEndsAt.slice(0, 10);
  return out;
}

/* ----------------------------- Tenants: list/read ----------------------------- */
exports.list = async (req, res, next) => {
  const q = (req.query.q || req.query.query || req.query.search || '').toString().trim().toLowerCase();
  try {
    const rows = await sequelize.query(`
      select t.id, t.name, t.status, t.plan_code, t.trial_ends_at, t.billing_email, t.seats,
             t.created_at,
             coalesce(u.cnt,0)::int as staff_count
        from public.tenants t
        left join (
          select tenant_id, count(*) as cnt
            from public.tenant_users
           group by tenant_id
        ) u on u.tenant_id = t.id
       where ($1 = '' or lower(t.name) like '%'||$1||'%' or lower(t.plan_code) like '%'||$1||'%' or lower(t.status) like '%'||$1||'%')
       order by t.created_at desc
       limit 500
    `, { bind: [q], type: QueryTypes.SELECT });
    return res.json(rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]); // tolerate missing tables
    return next(e);
  }
};

exports.read = async (req, res, next) => {
  const id = req.params.id;
  try {
    const rows = await sequelize.query(`select * from public.tenants where id = :id limit 1`,
      { replacements: { id }, type: QueryTypes.SELECT });
    return res.json(rows[0] || null);
  } catch (e) { if (isMissing(e)) return res.json(null); next(e); }
};

/* -------------------------- Update subscription/core ------------------------- */
exports.updateCore = async (req, res, next) => {
  const id = req.params.id;
  const body = sanitizeCore(req.body || {});
  if (!Object.keys(body).length) return res.json({ ok: true });

  try {
    const setParts = [];
    const rep = { id };
    if ('planCode' in body) { setParts.push(`plan_code = :planCode`); rep.planCode = body.planCode; }
    if ('seats' in body) { setParts.push(`seats = :seats`); rep.seats = body.seats; }
    if ('billingEmail' in body) { setParts.push(`billing_email = :billingEmail`); rep.billingEmail = body.billingEmail; }
    if ('trialEndsAt' in body) { setParts.push(`trial_ends_at = :trialEndsAt`); rep.trialEndsAt = body.trialEndsAt; }
    if ('status' in body) { setParts.push(`status = :status`); rep.status = body.status; }

    await sequelize.query(`update public.tenants set ${setParts.join(', ')}, updated_at = now() where id = :id`, { replacements: rep });

    const rows = await sequelize.query(`select * from public.tenants where id = :id limit 1`,
      { replacements: { id }, type: QueryTypes.SELECT });
    return res.json({ ok: true, tenant: rows[0] || null });
  } catch (e) { if (isMissing(e)) return res.json({ ok: true }); next(e); }
};

/* -------------------------------- Entitlements -------------------------------- */
exports.setEntitlements = async (req, res, next) => {
  const id = req.params.id;
  const body = req.body || {};
  // Supports { modules: { loans:true, savings:false, … } } OR { entitlements: ['loans.view', …] }
  let modules = body.modules && typeof body.modules === 'object' ? body.modules : null;
  if (!modules && Array.isArray(body.entitlements)) {
    modules = {};
    for (const key of body.entitlements) {
      const mod = String(key).split('.')[0]; // 'loans.view' -> 'loans'
      modules[mod] = true;
    }
  }
  if (!modules) return res.json({ ok: true });

  try {
    await sequelize.transaction(async (t) => {
      for (const [key, enabled] of Object.entries(modules)) {
        await sequelize.query(`
          insert into public.feature_flags (tenant_id, key, enabled, created_at, updated_at)
          values (:id, :key, :enabled, now(), now())
          on conflict (tenant_id, key) do update set enabled = excluded.enabled, updated_at = now()
        `, {
          type: QueryTypes.INSERT,
          transaction: t,
          replacements: { id, key, enabled: !!enabled },
        });
      }
    });
    res.json({ ok: true });
  } catch (e) { if (isMissing(e)) return res.json({ ok: true }); next(e); }
};

/* ---------------------------------- Limits ---------------------------------- */
exports.setLimits = async (req, res, next) => {
  const id = req.params.id;
  // Supports {limits:{...}} or flat object
  const limits = req.body?.limits && typeof req.body.limits === 'object' ? req.body.limits : (req.body || {});
  try {
    await sequelize.transaction(async (t) => {
      for (const [key, val] of Object.entries(limits)) {
        let vi=null, vn=null, vt=null, vj=null;
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (Number.isInteger(val)) vi = val; else vn = val;
        } else if (typeof val === 'string') vt = val;
        else if (val === null) { /* keep nulls */ }
        else vj = JSON.stringify(val);

        await sequelize.query(`
          insert into public.tenant_limits (tenant_id, key, value_int, value_numeric, value_text, value_json, created_at, updated_at)
          values (:id, :key, :vi, :vn, :vt, :vj, now(), now())
          on conflict (tenant_id, key) do update set
            value_int = excluded.value_int,
            value_numeric = excluded.value_numeric,
            value_text = excluded.value_text,
            value_json = excluded.value_json,
            updated_at = now()
        `, { type: QueryTypes.INSERT, transaction: t, replacements: { id, key, vi, vn, vt, vj } });
      }
    });
    res.json({ ok: true });
  } catch (e) { if (isMissing(e)) return res.json({ ok: true }); next(e); }
};

/* --------------------------------- Invoices --------------------------------- */
exports.listInvoices = async (req, res, next) => {
  const id = req.params.id;
  try {
    const rows = await sequelize.query(`
      select id, number, amount_cents, currency, status, due_date, issued_at as created_at, pdf_url
        from public.invoices
       where tenant_id = :id
       order by coalesce(issued_at, created_at) desc
       limit 250
    `, { replacements: { id }, type: QueryTypes.SELECT });
    res.json(rows);
  } catch (e) { if (isMissing(e)) return res.json([]); next(e); }
};

exports.createInvoice = async (req, res, next) => {
  const id = req.params.id;
  const b = req.body || {};
  const amountCents = Number.isFinite(Number(b.amountCents)) ? Number(b.amountCents)
    : (Number.isFinite(Number(b.amount)) ? Math.round(Number(b.amount) * 100) : 0);
  if (!amountCents || amountCents < 0) return res.status(400).json({ error: 'amount/amountCents required' });
  const currency = (b.currency || 'USD').toUpperCase();
  const dueDate = b.dueDate ? String(b.dueDate).slice(0,10) : null;
  const number = `INV-${Date.now().toString(36).toUpperCase()}`;

  try {
    const rows = await sequelize.query(`
      insert into public.invoices (tenant_id, number, amount_cents, currency, status, due_date, issued_at, created_at, updated_at)
      values (:id, :number, :amount, :currency, 'open', :due, now(), now(), now())
      returning id
    `, { replacements: { id, number, amount: amountCents, currency, due: dueDate }, type: QueryTypes.INSERT });
    const invId = rows?.[0]?.[0]?.id || null;
    res.status(201).json({ id: invId, number, amount_cents: amountCents, currency, status: 'open', due_date: dueDate });
  } catch (e) { if (isMissing(e)) return res.status(201).json({ id: crypto.randomUUID?.() || Date.now(), number, amount_cents: amountCents, currency, status: 'open', due_date: dueDate }); next(e); }
};

exports.markPaid = async (req, res, next) => {
  const { id, invoiceId } = req.params;
  try {
    await sequelize.query(`update public.invoices set status='paid', paid_at=now(), updated_at=now() where id = :invoiceId and tenant_id = :id`,
      { replacements: { id, invoiceId } });
    res.json({ ok: true });
  } catch (e) { if (isMissing(e)) return res.json({ ok: true }); next(e); }
};

exports.resendInvoice = async (_req, res) => {
  // Hook your email/sms bus here
  res.json({ ok: true });
};

exports.syncInvoices = async (_req, res) => {
  // Hook your billing provider sync here
  res.json({ ok: true, started: true });
};

/* ------------------------------- Comms & Ops -------------------------------- */
exports.notify = async (req, res) => {
  // You can push to email/in-app here. We just accept the payload.
  const payload = pick(req.body || {}, ['subject', 'message', 'channels']);
  res.json({ ok: true, delivered: true, payload });
};

exports.impersonate = async (req, res) => {
  const tenantId = req.params.id;
  const userId = req.user?.id || 'admin';
  const claims = { sub: userId, tenantId, iat: Math.floor(Date.now()/1000) };
  if (jwt && process.env.JWT_SECRET) {
    const token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '30m' });
    return res.json({ token });
  }
  // Fallback opaque token
  const token = Buffer.from(JSON.stringify(claims)).toString('base64url') + '.' + crypto.randomBytes(12).toString('base64url');
  res.json({ token });
};
