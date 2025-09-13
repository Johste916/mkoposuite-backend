'use strict';

const express = require('express');

function getModels() {
  try { return require('../models'); } catch {
    try { return require('../../models'); } catch { return null; }
  }
}

function makeMemoryStore() {
  const db = new Map(); // tenantId -> { nextId, items: Map }
  const ensure = (tenantId) => {
    const key = tenantId || 'default';
    if (!db.has(key)) db.set(key, { nextId: 1, items: new Map() });
    return db.get(key);
  };
  return { db, ensure };
}

module.exports = (() => {
  const r = express.Router();
  const models = getModels();
  const BankModel = models?.Bank || models?.Banks || null;

  const Op = models?.Sequelize?.Op || require('sequelize').Op;
  const dialect = models?.sequelize?.getDialect?.() || '';
  const LIKE = dialect === 'postgres' ? Op.iLike : Op.like;

  const mem = makeMemoryStore();

  function pickTenant(req) {
    return (
      req.user?.tenantId ||
      req.user?.tenant_id ||
      req.context?.tenantId ||
      req.headers['x-tenant-id'] ||
      process.env.DEFAULT_TENANT_ID ||
      null
    );
  }

  // GET /api/banks
  r.get('/', async (req, res) => {
    const tenantId = pickTenant(req);
    const q = String(req.query.search || '').trim();

    if (BankModel?.findAndCountAll) {
      const where = {
        ...(tenantId ? { tenantId } : {}),
        ...(q
          ? {
              [Op.or]: [
                { name: { [LIKE]: `%${q}%` } },
                { code: { [LIKE]: `%${q}%` } },
                { branch: { [LIKE]: `%${q}%` } },
                { accountName: { [LIKE]: `%${q}%` } },
                { accountNumber: { [LIKE]: `%${q}%` } },
                { swift: { [LIKE]: `%${q}%` } },
                { phone: { [LIKE]: `%${q}%` } },
              ],
            }
          : {}),
      };

      const { rows, count } = await BankModel.findAndCountAll({ where, order: [['name', 'ASC']] });
      res.setHeader('X-Total-Count', String(count));
      return res.json(rows);
    }

    // Memory fallback
    const store = mem.ensure(tenantId);
    let items = Array.from(store.items.values());
    if (q) {
      const Q = q.toLowerCase();
      items = items.filter((b) =>
        [b.name, b.code, b.branch, b.accountName, b.accountNumber, b.swift, b.phone]
          .some((v) => String(v || '').toLowerCase().includes(Q))
      );
    }
    res.setHeader('X-Total-Count', String(items.length));
    return res.json(items);
  });

  // POST /api/banks
  r.post('/', async (req, res) => {
    const tenantId = pickTenant(req);
    const b = req.body || {};

    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (BankModel && !tenantId) return res.status(400).json({ error: 'tenantId missing (header x-tenant-id or authenticated user context required)' });

    if (BankModel?.create) {
      try {
        const obj = await BankModel.create({
          tenantId,
          name: String(b.name).trim(),
          code: String(b.code || '').trim() || null,
          branch: String(b.branch || '').trim() || null,
          accountName: String(b.accountName || '').trim() || null,
          accountNumber: String(b.accountNumber || '').trim() || null,
          swift: String(b.swift || '').trim() || null,
          phone: String(b.phone || '').trim() || null,
          address: String(b.address || '').trim() || null,
          isActive: b.isActive !== false,
        });
        return res.status(201).json(obj);
      } catch (e) {
        console.error('[banks] create failed:', e);
        return res.status(500).json({ error: 'Failed to create bank' });
      }
    }

    // Memory fallback
    const store = mem.ensure(tenantId);
    const id = String(store.nextId++);
    const now = new Date().toISOString();
    const obj = {
      id,
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
      createdAt: now,
      updatedAt: now,
    };
    store.items.set(id, obj);
    return res.status(201).json(obj);
  });

  // GET /api/banks/:id
  r.get('/:id', async (req, res) => {
    const tenantId = pickTenant(req);
    const id = String(req.params.id);

    if (BankModel?.findByPk) {
      const obj = await BankModel.findByPk(id);
      if (!obj || (tenantId && obj.tenantId && obj.tenantId !== tenantId)) {
        return res.status(404).json({ error: 'Bank not found' });
      }
      return res.json(obj);
    }

    const store = mem.ensure(tenantId);
    const obj = store.items.get(id);
    if (!obj) return res.status(404).json({ error: 'Bank not found' });
    return res.json(obj);
  });

  // PUT /api/banks/:id
  r.put('/:id', async (req, res) => {
    const tenantId = pickTenant(req);
    const id = String(req.params.id);
    const b = req.body || {};

    if (BankModel?.findByPk) {
      const obj = await BankModel.findByPk(id);
      if (!obj || (tenantId && obj.tenantId && obj.tenantId !== tenantId)) {
        return res.status(404).json({ error: 'Bank not found' });
      }
      await obj.update({
        name: b.name ?? obj.name,
        code: b.code ?? obj.code,
        branch: b.branch ?? obj.branch,
        accountName: b.accountName ?? obj.accountName,
        accountNumber: b.accountNumber ?? obj.accountNumber,
        swift: b.swift ?? obj.swift,
        phone: b.phone ?? obj.phone,
        address: b.address ?? obj.address,
        isActive: typeof b.isActive === 'boolean' ? b.isActive : obj.isActive,
      });
      return res.json(obj);
    }

    const store = mem.ensure(tenantId);
    const obj = store.items.get(id);
    if (!obj) return res.status(404).json({ error: 'Bank not found' });
    Object.assign(obj, {
      name: b.name ?? obj.name,
      code: b.code ?? obj.code,
      branch: b.branch ?? obj.branch,
      accountName: b.accountName ?? obj.accountName,
      accountNumber: b.accountNumber ?? obj.accountNumber,
      swift: b.swift ?? obj.swift,
      phone: b.phone ?? obj.phone,
      address: b.address ?? obj.address,
      isActive: typeof b.isActive === 'boolean' ? b.isActive : obj.isActive,
      updatedAt: new Date().toISOString(),
    });
    return res.json(obj);
  });

  // DELETE /api/banks/:id
  r.delete('/:id', async (req, res) => {
    const tenantId = pickTenant(req);
    const id = String(req.params.id);

    if (BankModel?.destroy) {
      const obj = await BankModel.findByPk(id);
      if (!obj || (tenantId && obj.tenantId && obj.tenantId !== tenantId)) {
        return res.status(404).json({ error: 'Bank not found' });
      }
      await BankModel.destroy({ where: { id } });
      return res.status(204).end();
    }

    const store = mem.ensure(tenantId);
    const ok = store.items.delete(id);
    if (!ok) return res.status(404).json({ error: 'Bank not found' });
    return res.status(204).end();
  });

  return r;
})();
