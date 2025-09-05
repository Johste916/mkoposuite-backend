'use strict';
const { sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

exports.list = async (req, res, next) => { /* as in the sample you already added */ };
exports.read = async (req, res, next) => { /* select * from tenants where id=:id */ };
exports.patch = async (req, res, next) => { /* update core fields */ };

exports.setFeatures = async (req, res, next) => {
  try {
    const id = req.params.id;
    const flags = req.body || {}; // { payroll:true, sms:false }
    const entries = Object.entries(flags);
    await sequelize.transaction(async (t) => {
      for (const [key, enabled] of entries) {
        await sequelize.query(`
          insert into public.feature_flags (tenant_id, key, enabled)
          values (:id, :key, :enabled)
          on conflict (tenant_id, key) do update set enabled = excluded.enabled
        `, { transaction: t, type: QueryTypes.INSERT, replacements: { id, key, enabled }});
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.setLimits = async (req, res, next) => {
  try {
    const id = req.params.id;
    const limits = req.body || {}; // { seats: 10, borrowers: 5000 }
    const entries = Object.entries(limits);
    await sequelize.transaction(async (t) => {
      for (const [key, value] of entries) {
        await sequelize.query(`
          insert into public.tenant_limits (tenant_id, key, value)
          values (:id, :key, :value)
          on conflict (tenant_id, key) do update set value = excluded.value
        `, { transaction: t, type: QueryTypes.INSERT, replacements: { id, key, value }});
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.suspend = async (req, res, next) => { /* set status='suspended' */ };
exports.resume  = async (req, res, next) => { /* set status='active' if invoices ok */ };
