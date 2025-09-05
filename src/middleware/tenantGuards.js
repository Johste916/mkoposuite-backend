'use strict';
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const isMissing = (e) => e?.original?.code === '42P01' || e?.parent?.code === '42P01';

exports.ensureTenantActive = async (req, res, next) => {
  const id = req.headers['x-tenant-id'] || req.context?.tenantId || req.user?.tenantId;
  if (!id) return res.status(400).json({ error: 'Missing tenant id' });
  try {
    const row = await sequelize.query(
      `select status from public.tenants where id = :id limit 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    ).then(r => r[0]);
    if (!row) return next(); // dev: allow if not found (fallback handles)
    if (row.status === 'suspended') return res.status(402).json({ error: 'Tenant suspended for non-payment.' });
    next();
  } catch (e) { if (isMissing(e)) return next(); next(e); }
};

exports.requireEntitlement = (key) => async (req, res, next) => {
  const id = req.headers['x-tenant-id'] || req.context?.tenantId || req.user?.tenantId;
  if (!id) return res.status(400).json({ error: 'Missing tenant id' });
  try {
    const t = await sequelize.query(
      `select plan_code from public.tenants where id = :id limit 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    ).then(r => r[0]).catch(() => null);
    const plan = (t?.plan_code || 'basic').toLowerCase();

    const base = {
      basic:   { savings:1, loans:1, collections:1, accounting:1, sms:0, esignatures:0, payroll:0, investors:1, assets:1, collateral:1 },
      pro:     { savings:1, loans:1, collections:1, accounting:1, sms:1, esignatures:1, payroll:1, investors:1, assets:1, collateral:1 },
      premium: { savings:1, loans:1, collections:1, accounting:1, sms:1, esignatures:1, payroll:1, investors:1, assets:1, collateral:1 },
    }[plan] || {};

    let allowed = !!base[key];

    try {
      const rows = await sequelize.query(
        `select key, enabled from public.feature_flags where tenant_id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      const overrides = Object.fromEntries(rows.map(r => [r.key, !!r.enabled]));
      if (key in overrides) allowed = !!overrides[key];
    } catch (e) { if (!isMissing(e)) throw e; }

    if (!allowed) return res.status(403).json({ error: `Module "${key}" not enabled for plan.` });
    next();
  } catch (e) { if (isMissing(e)) return next(); next(e); }
};
