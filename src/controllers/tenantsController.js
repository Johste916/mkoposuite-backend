'use strict';
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

function getTenantId(req) {
  return req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;
}

const PLAN_DEFAULTS = {
  basic:   { savings: true, loans: true, collections: true, accounting: true, sms: false, esignatures: false, payroll: false, investors: true, assets: true, collateral: true },
  pro:     { savings: true, loans: true, collections: true, accounting: true, sms: true,  esignatures: true,  payroll: true,  investors: true, assets: true, collateral: true },
  premium: { savings: true, loans: true, collections: true, accounting: true, sms: true,  esignatures: true,  payroll: true,  investors: true, assets: true, collateral: true },
};

async function fetchTenant(tenantId) {
  const rows = await sequelize.query(
    `select * from public.tenants where id = :id limit 1`,
    { replacements: { id: tenantId }, type: QueryTypes.SELECT }
  );
  return rows[0] || null;
}

exports.me = async (req, res, next) => {
  try {
    const id = getTenantId(req);
    let t = await fetchTenant(id);
    if (!t) {
      // Soft auto-provision (optional)
      await sequelize.query(
        `insert into public.tenants (id, name, status, plan_code) values (:id, :name, 'trial', 'basic')
         on conflict (id) do nothing`,
        { replacements: { id, name: 'Organization' } }
      );
      t = await fetchTenant(id);
    }

    const today = new Date().toISOString().slice(0,10);
    const trialLeft = t?.trial_ends_at ? Math.ceil((Date.parse(t.trial_ends_at) - Date.parse(today)) / 86400000) : null;

    res.json({
      id: t.id,
      name: t.name,
      status: t.status,
      planCode: t.plan_code,
      trialEndsAt: t.trial_ends_at,
      trialDaysLeft: trialLeft,
      autoDisableOverdue: t.auto_disable_overdue,
      graceDays: t.grace_days,
      billingEmail: t.billing_email,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    });
  } catch (e) { next(e); }
};

exports.updateMe = async (req, res, next) => {
  try {
    const id = getTenantId(req);
    const { name, planCode, status, trialEndsAt, autoDisableOverdue, graceDays, billingEmail } = req.body || {};
    await sequelize.query(
      `update public.tenants
         set name = coalesce(:name, name),
             plan_code = coalesce(:planCode, plan_code),
             status = coalesce(:status, status),
             trial_ends_at = coalesce(:trialEndsAt, trial_ends_at),
             auto_disable_overdue = coalesce(:autoDisableOverdue, auto_disable_overdue),
             grace_days = coalesce(:graceDays, grace_days),
             billing_email = coalesce(:billingEmail, billing_email),
             updated_at = now()
       where id = :id`,
      { replacements: { id, name, planCode, status, trialEndsAt, autoDisableOverdue, graceDays, billingEmail } }
    );
    const t = await fetchTenant(id);
    res.json({ ok: true, tenant: t });
  } catch (e) { next(e); }
};

exports.entitlements = async (req, res, next) => {
  try {
    const id = getTenantId(req);
    const t = await fetchTenant(id);
    const plan = (t?.plan_code || 'basic').toLowerCase();
    const base = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.basic;

    const flags = await sequelize.query(
      `select key, enabled from public.feature_flags where tenant_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    const overrides = Object.fromEntries(flags.map(f => [f.key, !!f.enabled]));
    const modules = { ...base, ...overrides };

    res.json({ modules, planCode: plan, status: t?.status || 'trial' });
  } catch (e) { next(e); }
};

exports.cronCheck = async (_req, res, next) => {
  try {
    // 1) Past due invoices -> set tenant status 'suspended' if grace period exceeded
    await sequelize.query(`
      with past_due as (
        select i.tenant_id, t.grace_days, min(i.due_date) as first_due
        from public.invoices i
        join public.tenants t on t.id = i.tenant_id
        where i.status in ('open','past_due') and (i.due_date + (t.grace_days || ' days')::interval) < now()
        group by 1,2
      )
      update public.tenants t
         set status = 'suspended', updated_at = now()
        from past_due p
       where t.id = p.tenant_id and t.auto_disable_overdue = true and t.status <> 'suspended';
    `);

    // 2) Expired trials -> suspend
    await sequelize.query(`
      update public.tenants
         set status = 'suspended', updated_at = now()
       where status = 'trial' and trial_ends_at is not null and trial_ends_at < current_date;
    `);

    res.json({ ok: true });
  } catch (e) { next(e); }
};
