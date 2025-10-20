'use strict';

const express = require('express');

module.exports = (() => {
  const router = express.Router();

  const getModels = (req) => req.app.get('models') || {};
  const hasAttr = (Model, attr) =>
    !!(Model && Model.rawAttributes &&
      (Model.rawAttributes[attr] ||
        Object.values(Model.rawAttributes).some((a) => a.field === attr)));

  // GET /api/groups  → list (200 [] if none)
  router.get('/', async (req, res) => {
    try {
      const { BorrowerGroup, Branch, User, Sequelize } = getModels(req);
      if (!BorrowerGroup) return res.ok([]); // keep UI happy if model missing

      const { Op } = Sequelize || {};
      const where = {};
      const tId = req.headers['x-tenant-id'];

      if (tId && hasAttr(BorrowerGroup, 'tenantId')) where.tenantId = tId;
      if (req.query.status) where.status = String(req.query.status).toLowerCase();
      if (req.query.branchId && hasAttr(BorrowerGroup, 'branchId')) where.branchId = req.query.branchId;
      if (req.query.officerId && hasAttr(BorrowerGroup, 'officerId')) where.officerId = req.query.officerId;

      const q = String(req.query.q || '').trim();
      if (q && Op) {
        where[Op.or] = [{ name: { [Op.iLike]: `%${q}%` } }];
      }

      const attributes = ['id', 'name'].concat(
        ['branchId', 'officerId', 'status', 'meetingDay', 'createdAt', 'updatedAt'].filter((f) =>
          hasAttr(BorrowerGroup, f)
        )
      );

      const include = [];
      if (Branch && hasAttr(BorrowerGroup, 'branchId')) {
        include.push({ model: Branch, as: 'branch', attributes: ['id', 'name'] });
      }
      if (User && hasAttr(BorrowerGroup, 'officerId')) {
        include.push({ model: User, as: 'officer', attributes: ['id', 'name', 'email'] });
      }

      const rows = await BorrowerGroup.findAll({
        where,
        attributes,
        include,
        order: [['name', 'ASC']],
      });

      return res.ok(rows);
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  // GET /api/groups/:id  → single
  router.get('/:id', async (req, res) => {
    try {
      const { BorrowerGroup, BorrowerGroupMember, Borrower, Branch, User } = getModels(req);
      if (!BorrowerGroup) return res.ok(null);

      const include = [];
      if (BorrowerGroupMember) {
        const mem = { model: BorrowerGroupMember, as: 'groupMembers' };
        if (Borrower) mem.include = [{ model: Borrower, as: 'borrower', attributes: ['id', 'name', 'firstName', 'lastName'] }];
        include.push(mem);
      }
      if (Branch && hasAttr(BorrowerGroup, 'branchId')) include.push({ model: Branch, as: 'branch', attributes: ['id', 'name'] });
      if (User && hasAttr(BorrowerGroup, 'officerId')) include.push({ model: User, as: 'officer', attributes: ['id', 'name', 'email'] });

      const row = await BorrowerGroup.findByPk(String(req.params.id), { include });
      return res.ok(row);
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  // POST /api/groups  → create
  router.post('/', async (req, res) => {
    try {
      const { BorrowerGroup } = getModels(req);
      if (!BorrowerGroup) return res.status(501).json({ error: 'BorrowerGroup model not available' });

      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name is required' });

      const payload = { name };
      const setIf = (k) => {
        if (hasAttr(BorrowerGroup, k) && b[k] !== undefined) payload[k] = b[k] || null;
      };
      ['branchId', 'officerId', 'meetingDay', 'notes', 'status'].forEach(setIf);

      const tId = req.headers['x-tenant-id'];
      if (tId && hasAttr(BorrowerGroup, 'tenantId')) payload.tenantId = tId;

      if (payload.meetingDay) payload.meetingDay = String(payload.meetingDay).toLowerCase();

      const row = await BorrowerGroup.create(payload);
      return res.status(201).json(row);
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  // PATCH /api/groups/:id  → update
  router.patch('/:id', async (req, res) => {
    try {
      const { BorrowerGroup } = getModels(req);
      if (!BorrowerGroup) return res.status(501).json({ error: 'BorrowerGroup model not available' });

      const row = await BorrowerGroup.findByPk(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Group not found' });

      const b = req.body || {};
      const up = {};
      if (b.name !== undefined) up.name = String(b.name || '').trim();
      ['branchId', 'officerId', 'meetingDay', 'notes', 'status'].forEach((k) => {
        if (b[k] !== undefined && hasAttr(BorrowerGroup, k)) up[k] = b[k] || null;
      });
      if (up.meetingDay) up.meetingDay = String(up.meetingDay).toLowerCase();

      await row.update(up);
      return res.ok(row);
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  // DELETE /api/groups/:id  → soft delete if paranoid
  router.delete('/:id', async (req, res) => {
    try {
      const { BorrowerGroup } = getModels(req);
      if (!BorrowerGroup) return res.status(501).json({ error: 'BorrowerGroup model not available' });

      const row = await BorrowerGroup.findByPk(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Group not found' });

      await row.destroy();
      return res.status(204).end();
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  return router;
})();
