'use strict';
const { resolveTenantId, readMode, getDefaultTenantId } = require('../lib/tenant');

exports.me = async (req, res) => {
  const tenantId = resolveTenantId(req) || getDefaultTenantId();
  res.json({ tenantId, mode: readMode(), status: 'active' });
};

exports.entitlements = async (req, res) => {
  const tenantId = resolveTenantId(req) || getDefaultTenantId();
  res.json({
    tenantId,
    plan: 'trial',
    status: 'active',
    modules: {
      expenses: true, otherIncome: true, payroll: true, savings: true,
      investors: true, assets: true, accounting: true, reports: true,
      admin: true, loans: true, borrowers: true, repayments: true,
      collections: true, collateral: true, esignatures: true, branches: true,
      userManagement: true,
    },
    limits: { users: null },
    expiresAt: null,
  });
};
