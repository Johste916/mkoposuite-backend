'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser, requireAuth, authorizeRoles } = require('../../middleware/authMiddleware');

const ADMIN_ONLY = authorizeRoles('admin', 'director');
const ANY_AUTH = requireAuth;

/* ---------- helpers: Setting model (with safe fallback) ---------- */
let Setting;
try { ({ Setting } = require('../../models')); } catch {
  try { ({ Setting } = require('../../../models')); } catch {}
}

/** In-memory fallback so the UI works even without DB */
const mem = new Map(); // key => array

const tenantIdFrom = (req) => req.headers['x-tenant-id'] || req.context?.tenantId || null;
const keyFor = (tenantId, category) => `tenant:${tenantId || 'public'}:types:${String(category || '').toLowerCase()}`;
const now = () => new Date().toISOString();

async function getArr(req, category) {
  const key = keyFor(tenantIdFrom(req), category);
  if (Setting?.get) {
    const v = await Setting.get(key, []);
    return Array.isArray(v) ? v : [];
  }
  return mem.get(key) || [];
}

async function saveArr(req, category, arr) {
  const key = keyFor(tenantIdFrom(req), category);
  if (Setting?.set) {
    await Setting.set(key, arr, { tenantId: tenantIdFrom(req), updatedBy: req.user?.id || null, createdBy: req.user?.id || null });
    return;
  }
  mem.set(key, Array.isArray(arr) ? arr : []);
}

function makeId() { return Math.random().toString(36).slice(2, 10); }

/* ---------- routes (path-style) ---------- */
/** LIST: GET /api/admin/types/:category */
router.get('/:category', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const { category } = req.params;
    if (!category) return res.status(400).json({ error: 'category is required' });
    const rows = await getArr(req, category);
    res.setHeader('X-Total-Count', String(rows.length));
    return res.json(rows);
  } catch (e) { next(e); }
});

/** CREATE: POST /api/admin/types/:category  body: {name, code?, ...} */
router.post('/:category', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { category } = req.params;
    if (!category) return res.status(400).json({ error: 'category is required' });

    const list = await getArr(req, category);
    const item = {
      id: makeId(),
      name: String(req.body?.name || '').trim(),
      code: String(req.body?.code || '').trim() || null,
      meta: req.body?.meta || null,
      createdAt: now(),
      updatedAt: now(),
      createdBy: req.user?.id || null,
      updatedBy: req.user?.id || null,
    };
    list.push(item);
    await saveArr(req, category, list);
    return res.status(201).json(item);
  } catch (e) { next(e); }
});

/** UPDATE: PUT /api/admin/types/:category/:id */
router.put('/:category/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { category, id } = req.params;
    const list = await getArr(req, category);
    const idx = list.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const patch = req.body || {};
    const updated = {
      ...list[idx],
      ...patch,
      name: patch.name != null ? String(patch.name) : list[idx].name,
      code: patch.code != null ? String(patch.code) : list[idx].code,
      updatedAt: now(),
      updatedBy: req.user?.id || null,
    };
    list[idx] = updated;
    await saveArr(req, category, list);
    return res.json(updated);
  } catch (e) { next(e); }
});

/** DELETE: DELETE /api/admin/types/:category/:id */
router.delete('/:category/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { category, id } = req.params;
    const list = await getArr(req, category);
    const nextList = list.filter(x => String(x.id) !== String(id));
    if (nextList.length === list.length) return res.status(404).json({ error: 'Not found' });
    await saveArr(req, category, nextList);
    return res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
