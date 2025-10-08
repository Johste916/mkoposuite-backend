// routes/plansRoutes.js
'use strict';

const express = require('express');
const router = express.Router();

function getSequelize(req) {
  const models = req.app.get('models');
  if (models?.sequelize) return models.sequelize;
  try { return require('../models').sequelize; } catch { return null; }
}

function ok(res, data) { return (res.ok ? res.ok(data) : res.json(data)); }
function fail(res, code, msg) { return (res.fail ? res.fail(code, msg) : res.status(code).json({ error: msg })); }

/**
 * GET /api/plans
 * - Returns active plans from DB (billing_plans)
 * - Back-compat: if ?shape=array, returns an array; otherwise { plans: [...] }
 */
router.get('/', async (req, res) => {
  const sequelize = getSequelize(req);
  if (!sequelize) return fail(res, 503, 'DB unavailable');

  try {
    const [rows] = await sequelize.query(`
      SELECT id, code, name, description, price_cents, currency, "interval", features, is_active
      FROM public.billing_plans
      WHERE is_active = true
      ORDER BY price_cents ASC, code ASC
    `);

    const shape = String(req.query.shape || '').toLowerCase();
    if (shape === 'array') return ok(res, rows);
    return ok(res, { plans: rows });
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

/**
 * GET /api/plans/:code
 * - Fetch a single plan by code
 */
router.get('/:code', async (req, res) => {
  const sequelize = getSequelize(req);
  if (!sequelize) return fail(res, 503, 'DB unavailable');

  try {
    const [rows] = await sequelize.query(
      `
      SELECT id, code, name, description, price_cents, currency, "interval", features, is_active
      FROM public.billing_plans
      WHERE code = $1
      `,
      { bind: [String(req.params.code)] }
    );
    if (!rows.length) return fail(res, 404, 'Plan not found');
    return ok(res, rows[0]);
  } catch (e) {
    return fail(res, 500, e.message);
  }
});

module.exports = router;
