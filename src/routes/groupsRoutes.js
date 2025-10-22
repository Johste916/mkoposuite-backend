// routes/groups.js  (mount under /api/groups and /api/borrowers/groups)
'use strict';

const express = require('express');
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');

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

const pickArray = (x) =>
  Array.isArray(x) ? x : (x?.items || x?.rows || x?.data || x?.results || x?.members || x?.memberIds || x?.borrowers || x?.ids || []);

const buildInclude = (models, includeMembers) => {
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

const shapeOne = (g) => {
  const members = Array.isArray(g.groupMembers)
    ? g.groupMembers.map((m) => {
        const b = m.borrower || {};
        const nm = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ').trim();
        return {
          id: b.id ?? m.borrowerId,
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

// LIST
router.get('/', async (req, res) => {
  try {
    const models = getModels(req);
    const { BorrowerGroup, Sequelize } = models;
    if (!BorrowerGroup) return res.json([]);

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
    const include = buildInclude(models, includeMembers);

    const attrs = ['id','name'].concat(
      ['branchId','officerId','status','meetingDay','createdAt','updatedAt']
        .filter((f) => hasAttr(BorrowerGroup, f))
    );

    const rows = await BorrowerGroup.findAll({ where, attributes: attrs, include, order: [['name','ASC']] });

    if (!includeMembers) return res.json(rows);

    const shaped = rows.map((g) => ({
      id: g.id,
      name: g.name,
      branchName: g.branch?.name || null,
      membersCount: Array.isArray(g.groupMembers) ? g.groupMembers.length : 0,
      loanCount: 0,
      outstanding: 0,
    }));
    return res.json({ items: shaped, total: shaped.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET ONE
router.get('/:id', async (req, res) => {
  try {
    const models = getModels(req);
    const { BorrowerGroup } = models;
    if (!BorrowerGroup) return res.json(null);

    const row = await BorrowerGroup.findByPk(String(req.params.id), {
      include: buildInclude(models, true),
    });
    if (!row) return res.status(404).json({ error: 'Group not found' });
    return res.json(shapeOne(row));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// CREATE (supports initial members)
router.post('/', async (req, res) => {
  const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req);
  if (!BorrowerGroup) return res.status(501).json({ error: 'BorrowerGroup model not available' });

  const t = await sequelize.transaction();
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) { await t.rollback(); return res.status(400).json({ error: 'name is required' }); }

    const payload = { name };
    const setIf = (k, val) => { if (hasAttr(BorrowerGroup, k) && val !== undefined) payload[k] = clean(val); };

    setIf('branchId', b.branchId);
    setIf('officerId', officerFromBody(b));
    setIf('meetingDay', b.meetingDay);
    setIf('notes', b.notes);
    setIf('status', b.status);

    if (payload.meetingDay) {
      payload.meetingDay = String(payload.meetingDay).toLowerCase();
      if (!allowedDays.includes(payload.meetingDay)) { await t.rollback(); return res.status(400).json({ error: 'meetingDay must be monday…sunday' }); }
    }
    if (payload.status) {
      payload.status = String(payload.status).toLowerCase();
      if (!allowedStatus.includes(payload.status)) { await t.rollback(); return res.status(400).json({ error: 'status must be active|inactive' }); }
    }

    const tId = req.headers['x-tenant-id'];
    if (tId && hasAttr(BorrowerGroup, 'tenantId')) payload.tenantId = tId;

    const row = await BorrowerGroup.create(payload, { transaction: t });

    // optional initial members
    const ids = pickArray(b).map((x) => Number(x)).filter(Boolean);
    if (ids.length && BorrowerGroupMember) {
      const rows = ids.map((borrowerId) => ({
        groupId: row.id, borrowerId, role: 'member', joinedAt: new Date(),
      }));
      // insert with unique check
      for (const r of rows) {
        await BorrowerGroupMember.findOrCreate({
          where: { groupId: r.groupId, borrowerId: r.borrowerId },
          defaults: r,
          transaction: t,
        });
      }
    }

    await t.commit();
    return res.status(201).json({ id: row.id, name: row.name });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: e.message });
  }
});

// UPDATE
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
    if (hasAttr(BorrowerGroup, 'officerId') &&
        (b.officerId !== undefined || b.loanOfficerId !== undefined || b.loan_officer_id !== undefined)) {
      up.officerId = clean(officerFromBody(b));
    }
    if (b.meetingDay !== undefined && hasAttr(BorrowerGroup, 'meetingDay')) {
      up.meetingDay = clean(b.meetingDay);
      if (up.meetingDay) {
        up.meetingDay = String(up.meetingDay).toLowerCase();
        if (!allowedDays.includes(up.meetingDay)) return res.status(400).json({ error: 'meetingDay must be monday…sunday' });
      }
    }
    if (b.status !== undefined && hasAttr(BorrowerGroup, 'status')) {
      up.status = clean(b.status);
      if (up.status) {
        up.status = String(up.status).toLowerCase();
        if (!allowedStatus.includes(up.status)) return res.status(400).json({ error: 'status must be active|inactive' });
      }
    }
    if (b.notes !== undefined && hasAttr(BorrowerGroup, 'notes')) up.notes = clean(b.notes);

    await row.update(up);
    const fresh = await BorrowerGroup.findByPk(String(req.params.id), {
      include: buildInclude(getModels(req), true),
    });
    return res.json(shapeOne(fresh));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ADD MEMBER (single)
router.post('/:id/members', async (req, res) => {
  const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req) || {};
  if (!BorrowerGroup || !BorrowerGroupMember) {
    return res.status(501).json({ error: 'Group/Member model not available' });
  }
  const t = await sequelize.transaction();
  try {
    const groupId = String(req.params.id);
    const borrowerId = clean(req.body?.borrowerId);
    if (!borrowerId) { await t.rollback(); return res.status(400).json({ error: 'borrowerId is required' }); }

    const group = await BorrowerGroup.findByPk(groupId, { transaction: t });
    if (!group) { await t.rollback(); return res.status(404).json({ error: 'Group not found' }); }

    await BorrowerGroupMember.findOrCreate({
      where: { groupId, borrowerId },
      defaults: { role: 'member', joinedAt: new Date() },
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ groupId: Number(groupId), borrowerId: Number(borrowerId) });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: e.message });
  }
});

// ADD MEMBERS (bulk)
router.post('/:id/members/bulk', async (req, res) => {
  const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req) || {};
  if (!BorrowerGroup || !BorrowerGroupMember) {
    return res.status(501).json({ error: 'Group/Member model not available' });
  }
  const t = await sequelize.transaction();
  try {
    const groupId = String(req.params.id);
    const ids = pickArray(req.body).map((x) => Number(x)).filter(Boolean);
    if (!ids.length) { await t.rollback(); return res.status(400).json({ error: 'No borrower IDs provided' }); }

    const group = await BorrowerGroup.findByPk(groupId, { transaction: t });
    if (!group) { await t.rollback(); return res.status(404).json({ error: 'Group not found' }); }

    let created = 0, skipped = 0;
    for (const borrowerId of ids) {
      const [, wasCreated] = await BorrowerGroupMember.findOrCreate({
        where: { groupId, borrowerId },
        defaults: { role: 'member', joinedAt: new Date() },
        transaction: t,
      });
      wasCreated ? created++ : skipped++;
    }

    await t.commit();
    return res.json({ created, skipped, total: ids.length });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: e.message });
  }
});

// REMOVE MEMBER
router.delete('/:id/members/:borrowerId', async (req, res) => {
  const { BorrowerGroupMember, sequelize } = getModels(req) || {};
  if (!BorrowerGroupMember) return res.status(501).json({ error: 'BorrowerGroupMember model not available' });
  const t = await sequelize.transaction();
  try {
    const groupId = String(req.params.id);
    const borrowerId = String(req.params.borrowerId);
    const cnt = await BorrowerGroupMember.destroy({ where: { groupId, borrowerId }, transaction: t });
    await t.commit();
    if (!cnt) return res.status(404).json({ error: 'Member not found in this group' });
    return res.json({ success: true });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: e.message });
  }
});

// CSV IMPORT
router.post('/:id/members/import', upload.single('file'), async (req, res) => {
  const { BorrowerGroup, BorrowerGroupMember, sequelize } = getModels(req) || {};
  if (!BorrowerGroup || !BorrowerGroupMember) return res.status(501).json({ error: 'Group/Member model not available' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const t = await sequelize.transaction();
  try {
    const groupId = String(req.params.id);
    const group = await BorrowerGroup.findByPk(groupId, { transaction: t });
    if (!group) { await t.rollback(); return res.status(404).json({ error: 'Group not found' }); }

    const text = req.file.buffer.toString('utf8');
    const rows = csvParse(text, { columns: true, skip_empty_lines: true, trim: true });

    let created = 0; let skipped = 0;
    for (const r of rows) {
      const borrowerId = clean(r.borrowerId);
      if (!borrowerId) { skipped++; continue; }
      const role = (r.role || 'member').toLowerCase();
      const [, wasCreated] = await BorrowerGroupMember.findOrCreate({
        where: { groupId, borrowerId },
        defaults: { role, joinedAt: new Date() },
        transaction: t,
      });
      wasCreated ? created++ : skipped++;
    }
    await t.commit();
    return res.json({ created, skipped, total: rows.length });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
