'use strict';
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../models');

/**
 * /api/search or /api/borrowers/search
 * Supports:
 *   q          : search term
 *   branchId   : optional filter (when Borrower has branchId column)
 *   limit      : default 20, max 100
 *   tenant     : inferred from x-tenant-id header when Borrower has tenantId column
 */
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const branchId = req.query.branchId ? String(req.query.branchId) : null;
  const headerTenant = req.headers['x-tenant-id'] || null;

  const Borrower = sequelize.models?.Borrower;
  if (!Borrower) return res.json([]);

  const where = {};

  // Optional tenant scoping if column exists
  if (headerTenant && Borrower.rawAttributes?.tenantId) {
    where.tenantId = headerTenant;
  }

  // Optional branch filter if column exists
  if (branchId && Borrower.rawAttributes?.branchId) {
    where.branchId = branchId;
  }

  if (q) {
    const like = { [Op.iLike]: `%${q}%` };
    const maybeNum = Number(q);
    const or = [{ name: like }];
    if (Borrower.rawAttributes?.phone) or.push({ phone: like });
    if (Number.isFinite(maybeNum) && Borrower.rawAttributes?.id) or.push({ id: maybeNum });
    where[Op.or] = or;
  }

  const rows = await Borrower.findAll({
    where,
    order: [['name', 'ASC']],
    limit,
    attributes: ['id', 'name', ...(Borrower.rawAttributes?.phone ? ['phone'] : [])],
  });

  // Shape consistent result
  const items = rows.map(r => ({
    id: r.id,
    type: 'borrower',
    name: r.name,
    phone: r.phone || null,
  }));

  res.setHeader('X-Total-Count', String(items.length));
  res.json(items);
});

module.exports = router;
