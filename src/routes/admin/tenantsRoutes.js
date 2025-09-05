'use strict';
const express = require('express');
const router = express.Router();
const { sequelize } = require('../../models');
const { QueryTypes } = require('sequelize');

// TODO: swap for your real guard. Must allow role 'super_admin' (or similar).
function requireSuperAdmin(req, res, next) {
  const role = req.user?.role || req.user?.roles?.[0];
  if (role === 'super_admin' || role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// List tenants (paged, optional search ?q=)
router.get('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 25);
    const q = (req.query.q || '').trim().toLowerCase();
    const where = q ? `WHERE LOWER(name) LIKE :q OR LOWER(billing_email) LIKE :q` : '';

    const rows = await sequelize.query(
      `SELECT id, name, status, plan_code, trial_ends_at, billing_email, created_at, updated_at
       FROM public.tenants
       ${where}
       ORDER BY created_at DESC
       LIMIT :lim OFFSET :off;`,
      { type: QueryTypes.SELECT, replacements: { q: `%${q}%`, lim: pageSize, off: (page - 1) * pageSize } }
    );
    const [{ count }] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM public.tenants ${where};`,
      { type: QueryTypes.SELECT, replacements: { q: `%${q}%` } }
    );
    res.set('X-Total-Count', String(count));
    res.json(rows);
  } catch (e) { next(e); }
});

// Read one
router.get('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const row = await sequelize.query(
      `SELECT * FROM public.tenants WHERE id = :id LIMIT 1;`,
      { type: QueryTypes.SELECT, replacements: { id: req.params.id } }
    );
    res.json(row[0] || null);
  } catch (e) { next(e); }
});

// Update plan/status/billing
router.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const { planCode, status, trialEndsAt, graceDays, autoDisableOverdue, billingEmail, name } = req.body || {};
    await sequelize.query(
      `UPDATE public.tenants
         SET name = COALESCE(:name, name),
             plan_code = COALESCE(:planCode, plan_code),
             status = COALESCE(:status, status),
             trial_ends_at = COALESCE(:trialEndsAt, trial_ends_at),
             grace_days = COALESCE(:graceDays, grace_days),
             auto_disable_overdue = COALESCE(:autoDisableOverdue, auto_disable_overdue),
             billing_email = COALESCE(:billingEmail, billing_email),
             updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: req.params.id, planCode, status, trialEndsAt, graceDays, autoDisableOverdue, billingEmail, name } }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Suspend / Resume
router.post('/:id/suspend', requireSuperAdmin, async (req, res, next) => {
  try {
    await sequelize.query(
      `UPDATE public.tenants SET status = 'suspended', updated_at = NOW() WHERE id = :id;`,
      { replacements: { id: req.params.id } }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/:id/resume', requireSuperAdmin, async (req, res, next) => {
  try {
    await sequelize.query(
      `UPDATE public.tenants SET status = 'active', updated_at = NOW() WHERE id = :id;`,
      { replacements: { id: req.params.id } }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
