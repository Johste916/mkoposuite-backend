'use strict';
const express = require('express');
const router = express.Router();
const { sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

// GET /api/admin/tenants
router.get('/', async (_req, res, next) => {
  try {
    const rows = await sequelize.query(`
      select id, name, status, plan_code, trial_ends_at, grace_days, billing_email, created_at, updated_at
        from public.tenants
       order by created_at desc
       limit 500
    `, { type: QueryTypes.SELECT });
    res.json(rows);
  } catch (e) { next(e); }
});

// PATCH /api/admin/tenants/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, status, planCode, trialEndsAt, graceDays, billingEmail } = req.body || {};
    await sequelize.query(`
      update public.tenants
         set name = coalesce(:name, name),
             status = coalesce(:status, status),
             plan_code = coalesce(:planCode, plan_code),
             trial_ends_at = coalesce(:trialEndsAt, trial_ends_at),
             grace_days = coalesce(:graceDays, grace_days),
             billing_email = coalesce(:billingEmail, billing_email),
             updated_at = now()
       where id = :id
    `, { replacements: { id, name, status, planCode, trialEndsAt, graceDays, billingEmail } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
