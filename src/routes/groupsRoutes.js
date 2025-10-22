'use strict';

const express = require('express');
// CSV import (optional). If you use it, add deps: `npm i multer csv-parse`
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');

module.exports = (() => {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  const allowedDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const allowedStatus = ['active','inactive'];

  const getModels = (req) => req.app.get('models') || {};
  const hasAttr = (Model, attr) =>
    !!(Model && Model.rawAttributes &&
      (Model.rawAttributes[attr] ||
        Object.values(Model.rawAttributes).some((a) => a.field === attr)));

  const clean = (v) => (v === '' ? null : v);
  const officerFromBody = (b) =>
    b?.officerId ?? b?.loanOfficerId ?? b?.loan_officer_id ?? null;

  // Build include for group fetches
  const buildGroupInclude = (models, includeMembers = false) => {
    const { BorrowerGroup, BorrowerGroupMember, Borrower, Branch, User } = models;
    const inc = [];

    if (includeMembers && BorrowerGroupMember) {
      const mem = {
        model: BorrowerGroupMember,
        as: 'groupMembers',
        attributes: ['groupId', 'borrowerId', 'role', 'joinedAt', 'leftAt'],
      };
      if (Borrower) {
        mem.include = [{
          model: Borrower,
          as: 'borrower',
          attributes: ['id', 'name', 'firstName', 'lastName', 'phone'],
        }];
      }
      inc.push(mem);
    }

    if (Branch && hasAttr(BorrowerGroup, 'branchId')) {
      inc.push({ model: Branch, as: 'branch', attributes: ['id', 'name'] });
    }
    if (User && hasAttr(BorrowerGroup, 'officerId')) {
      inc.push({ model: User, as: 'officer', attributes: ['id', 'name', 'email'] });
    }
    return inc;
  };

  // Shape one group for the UI (normalizes names + member list)
  const shapeGroup = (g) => {
    const members = Array.isArray(g.groupMembers)
      ? g.groupMembers.map((m) => {
          const b = m.borrower || {};
          const nm = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ').trim();
          return {
            id: b.id ?? m.borrowerId,          // UI expects borrower id here
            name: nm || String(b.id ?? m.borrowerId),
            phone: b.phone || null,
            role: m.role || 'member',
          };
        })
      : [];

    return {
      id: g.id,
      name: g.name,
      branchId: hasAttr(g.constructor, 'branchId') ? g.branchId ?? null : null,
      branchName: g.branch?.name || null,
      loanOfficerId: hasAttr(g.constructor, 'officerId') ? g.officerId ?? null : null,
      officerName: g.officer?.name || null,
      meetingDay: g.meetingDay || null,
      status: g.status || 'active',
      members,
    };
  };

  // GET /api/groups  → list
  router.get('/', async (req, res) => {
    try {
      const models = getModels(req);
      const { BorrowerGroup, Sequelize } = models;
      if (!BorrowerGroup) return res.ok([]);

      const { Op } = Sequelize || {};
      const where = {};
      const tId = req.headers['x-tenant-id'];

      if (tId && hasAttr(BorrowerGroup, 'tenantId')) where.tenantId = tId;
      if (req.query.status) where.status = String(req.query.status).toLowerCase();
      if (req.query.branchId && hasAttr(BorrowerGroup, 'branchId')) where.branchId = req.query.branchId;
      if (req.query.officerId && hasAttr(BorrowerGroup, 'officerId')) where.officerId = req.query.officerId;

      const q = String(req.query.q || '').trim();
      if (q && Op) where[Op.or] = [{ name: { [Op.iLike]: `%${q}%` } }];

      const includeMembers = String(req.query.include || '').split(',').includes('members');
      const include = buildGroupInclude(models, includeMembers);

      const attrs = ['id','name']
        .concat(['branchId','officerId','status','meetingDay','createdAt','updatedAt']
        .filter((f) => hasAttr(BorrowerGroup, f)));

      const rows = await BorrowerGroup.findAll({
        where,
        attributes: attrs,
        include,
        order: [['name', 'ASC']],
      });

      if (!includeMembers) {
        // Return raw rows (keeps your prior behavior)
        return res.ok(rows);
      }

      // When include=members, return a compact summary (what the list page expects)
      const shaped = rows.map((g) => ({
        id: g.id,
        name: g.name,
        branchName: g.branch?.name || null,
        membersCount: Array.isArray(g.groupMembers) ? g.groupMembers.length : 0,
        loanCount: 0,
        outstanding: 0,
      }));
      return res.ok({ items: shaped, total: shaped.length });
    } catch (e) {
      return res.fail(500, e.message);
    }
  });

  // GET /api/groups/:id  → single (with members)
  router.get('/:id', async (req, res) => {
    try {
      const models = getModels(req);
      const { BorrowerGroup } = models;
      if (!BorrowerGroup) return res.ok(null);

      const row = await BorrowerGroup.findByPk(String(req.params.id), {
        include: buildGroupInclude(models, true),
      });
      if (!row) return res.status(404).json({ error: 'Group not found' });

      return res.ok(shapeGroup(row));
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
      const setIf = (k, val) => {
        if (hasAttr(BorrowerGroup, k) && val !== undefined) payload[k] = clean(val);
      };

      setIf('branchId', b.branchId);
      setIf('officerId', officerFromBody(b));
      setIf('meetingDay', b.meetingDay);
      setIf('notes', b.notes);
      setIf('status', b.status);

      if (payload.meetingDay) {
        payload.meetingDay = String(payload.meetingDay).toLowerCase();
        if (!allowedDays.includes(payload.meetingDay)) {
          return res.status(400).json({ error: 'meetingDay must be monday…sunday' });
        }
      }
      if (payload.status) {
        payload.status = String(payload.status).toLowerCase();
        if (!allowedStatus.includes(payload.status)) {
          return res.status(400).json({ error: 'status must be active|inactive' });
        }
      }

      const tId = req.headers['x-tenant-id'];
      if (tId && hasAttr(BorrowerGroup, 'tenantId')) payload.tenantId = tId;

      const row = await BorrowerGroup.create(payload);
      return res.status(201).json(shapeGroup(row));
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
      if (hasAttr(BorrowerGroup, 'branchId') && b.branchId !== undefined) up.branchId = clean(b.branchId);

      // officerId ← loanOfficerId / loan_officer_id / officerId
      if (hasAttr(BorrowerGroup, 'officerId') &&
          (b.officerId !== undefined || b.loanOfficerId !== undefined || b.loan_officer_id !== undefined)) {
        up.officerId = clean(officerFromBody(b));
      }

      if (b.meetingDay !== undefined && hasAttr(BorrowerGroup, 'meetingDay')) {
        up.meetingDay = clean(b.meetingDay);
        if (up.meetingDay) {
          up.meetingDay = String(up.meetingDay).toLowerCase();
          if (!allowedDays.includes(up.meetingDay)) {
            return res.status(400).json({ error: 'meetingDay must be monday…sunday' });
          }
        }
      }

      if (b.status !== undefined && hasAttr(BorrowerGroup, 'status')) {
        up.status = clean(b.status);
        if (up.status) {
          up.status = String(up.status).toLowerCase();
          if (!allowedStatus.includes(up.status)) {
            return res.status(400).json({ error: 'status must be active|inactive' });
          }
        }
      }

      if (b.notes !== undefined && hasAttr(BorrowerGroup, 'notes')) up.notes = clean(b.notes);

      await row.update(up);
      // return the shaped version w/ members & names
      const fresh = await BorrowerGroup.findByPk(String(req.params.id), {
        include: buildGroupInclude(getModels(req), true),
      });
      return res.ok(shapeGroup(fresh));
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

  // POST /api/groups/:id/members  → add borrower to group
  router.post('/:id/members', async (req, res) => {
    const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req);
    if (!BorrowerGroup || !BorrowerGroupMember) {
      return res.status(501).json({ error: 'Group/Member model not available' });
    }
    const t = await sequelize.transaction();
    try {
      const groupId = String(req.params.id);
      const borrowerId = clean(req.body?.borrowerId);
      if (!borrowerId) {
        await t.rollback();
        return res.status(400).json({ error: 'borrowerId is required' });
      }

      const group = await BorrowerGroup.findByPk(groupId, { transaction: t });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: 'Group not found' });
      }

      await BorrowerGroupMember.findOrCreate({
        where: { groupId, borrowerId },
        defaults: { role: 'member', joinedAt: new Date() },
        transaction: t,
      });

      await t.commit();
      return res.status(201).json({ groupId: Number(groupId), borrowerId: Number(borrowerId) });
    } catch (e) {
      await t.rollback();
      return res.fail(500, e.message);
    }
  });

  // DELETE /api/groups/:id/members/:borrowerId  → remove borrower from group
  router.delete('/:id/members/:borrowerId', async (req, res) => {
    const { BorrowerGroupMember, sequelize } = getModels(req);
    if (!BorrowerGroupMember) return res.status(501).json({ error: 'BorrowerGroupMember model not available' });

    const t = await sequelize.transaction();
    try {
      const groupId = String(req.params.id);
      const borrowerId = String(req.params.borrowerId);

      const cnt = await BorrowerGroupMember.destroy({ where: { groupId, borrowerId }, transaction: t });
      await t.commit();

      if (!cnt) return res.status(404).json({ error: 'Member not found in this group' });
      return res.ok({ success: true });
    } catch (e) {
      await t.rollback();
      return res.fail(500, e.message);
    }
  });

  // POST /api/groups/:id/members/import  → CSV import (optional)
  // CSV columns: borrowerId[, role]
  router.post('/:id/members/import', upload.single('file'), async (req, res) => {
    const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req);
    if (!BorrowerGroup || !BorrowerGroupMember) {
      return res.status(501).json({ error: 'Group/Member model not available' });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const t = await sequelize.transaction();
    try {
      const groupId = String(req.params.id);
      const group = await BorrowerGroup.findByPk(groupId, { transaction: t });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: 'Group not found' });
      }

      const text = req.file.buffer.toString('utf8');
      const rows = csvParse(text, { columns: true, skip_empty_lines: true, trim: true });

      let created = 0; let skipped = 0;
      for (const r of rows) {
        const borrowerId = clean(r.borrowerId);
        if (!borrowerId) { skipped++; continue; }
        const role = (r.role || 'member').toLowerCase();
        await BorrowerGroupMember.findOrCreate({
          where: { groupId, borrowerId },
          defaults: { role, joinedAt: new Date() },
          transaction: t,
        }).then(([/*row*/, wasCreated]) => { if (wasCreated) created++; else skipped++; });
      }

      await t.commit();
      return res.ok({ created, skipped, total: rows.length });
    } catch (e) {
      await t.rollback();
      return res.fail(500, e.message);
    }
  });

  return router;
})();
