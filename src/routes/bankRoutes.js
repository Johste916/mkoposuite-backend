// backend/routes/bankRoutes.js
'use strict';
const express = require('express');

function makeMemoryStore() {
  const byTenant = new Map(); // tenantId -> Map(id -> bank)
  let nextId = 1;
  return {
    list(tenantId) {
      if (!byTenant.has(tenantId)) byTenant.set(tenantId, new Map());
      return Array.from(byTenant.get(tenantId).values()).filter(b => b.isActive !== false);
    },
    get(tenantId, id) {
      if (!byTenant.has(tenantId)) return null;
      return byTenant.get(tenantId).get(String(id)) || null;
    },
    create(tenantId, data) {
      if (!byTenant.has(tenantId)) byTenant.set(tenantId, new Map());
      const id = String(nextId++);
      const now = new Date().toISOString();
      const rec = { id, tenantId, isActive: true, createdAt: now, updatedAt: now, ...data };
      byTenant.get(tenantId).set(id, rec);
      return rec;
    },
    update(tenantId, id, patch) {
      const cur = this.get(tenantId, id);
      if (!cur) return null;
      const upd = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      byTenant.get(tenantId).set(String(id), upd);
      return upd;
    },
    remove(tenantId, id) {
      if (!byTenant.has(tenantId)) return false;
      return byTenant.get(tenantId).delete(String(id));
    },
  };
}

module.exports = (() => {
  const r = express.Router();
  let models = null;
  try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

  const mem = makeMemoryStore();

  const getTenantId = (req) =>
    req.context?.tenantId || req.headers['x-tenant-id'] || null;

  const useDb = () => !!(models && models.sequelize && models.Bank);

  r.get('/', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required (x-tenant-id header).' });

    const q = String(req.query.search || '').trim();
    const showInactive = String(req.query.showInactive || '') === '1';
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '100', 10)));

    if (!useDb()) {
      let items = mem.list(tenantId);
      if (q) {
        const qq = q.toLowerCase();
        items = items.filter(b =>
          [b.name, b.code, b.branch, b.accountName, b.accountNumber, b.swift]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(qq))
        );
      }
      if (!showInactive) items = items.filter(b => b.isActive !== false);
      const total = items.length;
      const paged = items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
      res.setHeader('X-Total-Count', String(total));
      return res.json(paged);
    }

    const { Bank, Sequelize } = models;
    const { Op } = Sequelize;
    const where = { tenantId };
    if (!showInactive) where.isActive = true;

    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { code: { [Op.iLike]: `%${q}%` } },
        { branch: { [Op.iLike]: `%${q}%` } },
        { accountName: { [Op.iLike]: `%${q}%` } },
        { accountNumber: { [Op.iLike]: `%${q}%` } },
        { swift: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const { rows, count } = await Bank.findAndCountAll({
      where,
      order: [['name', 'ASC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.setHeader('X-Total-Count', String(count));
    res.json(rows);
  });

  r.get('/:id', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required.' });

    if (!useDb()) {
      const item = mem.get(tenantId, req.params.id);
      return res.json(item || null);
    }

    const item = await models.Bank.findOne({ where: { id: req.params.id, tenantId } });
    return res.json(item || null);
  });

  r.post('/', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required.' });

    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Bank name is required.' });

    const payload = {
      tenantId,
      name: String(b.name).trim(),
      code: b.code || null,
      branch: b.branch || null,
      accountName: b.accountName || null,
      accountNumber: b.accountNumber || null,
      swift: b.swift || null,
      phone: b.phone || null,
      address: b.address || null,
      isActive: b.isActive !== false,
    };

    if (!useDb()) {
      const created = mem.create(tenantId, payload);
      return res.status(201).json(created);
    }

    const created = await models.Bank.create(payload);
    return res.status(201).json(created);
  });

  r.put('/:id', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required.' });

    const b = req.body || {};
    const patch = {
      name: b.name,
      code: b.code,
      branch: b.branch,
      accountName: b.accountName,
      accountNumber: b.accountNumber,
      swift: b.swift,
      phone: b.phone,
      address: b.address,
    };

    if (!useDb()) {
      const upd = mem.update(tenantId, req.params.id, patch);
      if (!upd) return res.status(404).json({ error: 'Not found' });
      return res.json(upd);
    }

    const item = await models.Bank.findOne({ where: { id: req.params.id, tenantId } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.update(patch);
    res.json(item);
  });

  // Soft delete by default; add ?hard=1 to really delete
  r.delete('/:id', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required.' });
    const hard = String(req.query.hard || '') === '1';

    if (!useDb()) {
      if (hard) mem.remove(tenantId, req.params.id);
      else mem.update(tenantId, req.params.id, { isActive: false });
      return res.status(204).end();
    }

    const item = await models.Bank.findOne({ where: { id: req.params.id, tenantId } });
    if (!item) return res.status(404).json({ error: 'Not found' });

    if (hard) await item.destroy();
    else await item.update({ isActive: false });

    res.status(204).end();
  });

  return r;
})();
