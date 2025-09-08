'use strict';

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const isMissingTable = (e) =>
  e?.original?.code === '42P01' || e?.parent?.code === '42P01';

/** GET /stats — mirrors /api/admin/tenants/stats but tolerant */
router.get('/stats', async (_req, res, next) => {
  try {
    // Try with tenant_users; if missing, return seats + staffCount=0
    try {
      const items = await sequelize.query(
        `
        SELECT t.id,
               COALESCE(tu.staff_count, 0)::int AS "staffCount",
               t.seats
        FROM public.tenants t
        LEFT JOIN (
          SELECT tenant_id, COUNT(*)::int AS staff_count
          FROM public.tenant_users
          GROUP BY tenant_id
        ) tu ON tu.tenant_id = t.id
        `,
        { type: QueryTypes.SELECT }
      );
      return res.json({ items });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      const items = await sequelize.query(
        `SELECT id, 0::int AS "staffCount", seats FROM public.tenants`,
        { type: QueryTypes.SELECT }
      );
      return res.json({ items });
    }
  } catch (e) { next(e); }
});

/** GET /:id/invoices — tolerant (returns [] if invoices table missing) */
router.get('/:id/invoices', async (req, res, next) => {
  try {
    try {
      const rows = await sequelize.query(
        `
        SELECT id, number, amount_cents, currency, status, due_date, issued_at, paid_at
        FROM public.invoices
        WHERE tenant_id = :id
        ORDER BY COALESCE(issued_at, created_at) DESC
        LIMIT 250
        `,
        { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
      );
      return res.json({ invoices: rows });
    } catch (e) {
      if (isMissingTable(e)) return res.json({ invoices: [] });
      throw e;
    }
  } catch (e) { next(e); }
});

/** POST /:id/invoices/sync — always OK (UI button) */
router.post('/:id/invoices/sync', (_req, res) => res.json({ ok: true }));

module.exports = router;
