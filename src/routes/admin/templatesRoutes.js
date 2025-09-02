'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser, requireAuth, authorizeRoles } = require('../../middleware/authMiddleware');

const ADMIN_ONLY = authorizeRoles('admin', 'director');
const ANY_AUTH = requireAuth;

let Setting;
try { ({ Setting } = require('../../models')); } catch {
  try { ({ Setting } = require('../../../models')); } catch {}
}

const mem = new Map();

const tenantIdFrom = (req) => req.headers['x-tenant-id'] || req.context?.tenantId || null;
const keyFor = (tenantId, channel) => `tenant:${tenantId || 'public'}:templates:${String(channel || '').toLowerCase()}`;
const now = () => new Date().toISOString();

async function getArr(req, channel) {
  const key = keyFor(tenantIdFrom(req), channel);
  if (Setting?.get) {
    const v = await Setting.get(key, []);
    return Array.isArray(v) ? v : [];
  }
  return mem.get(key) || [];
}

async function saveArr(req, channel, arr) {
  const key = keyFor(tenantIdFrom(req), channel);
  if (Setting?.set) {
    await Setting.set(key, arr, { tenantId: tenantIdFrom(req), updatedBy: req.user?.id || null, createdBy: req.user?.id || null });
    return;
  }
  mem.set(key, Array.isArray(arr) ? arr : []);
}

function makeId() { return Math.random().toString(36).slice(2, 10); }

/* Shape:
 * { id, name, channel, subject?, body, vars?:[], createdAt, updatedAt, ... }
 */

/** LIST: GET /api/admin/templates/:channel */
router.get('/:channel', authenticateUser, ANY_AUTH, async (req, res, next) => {
  try {
    const { channel } = req.params; // 'email' | 'sms' | etc
    if (!channel) return res.status(400).json({ error: 'channel is required' });
    const rows = await getArr(req, channel);
    res.setHeader('X-Total-Count', String(rows.length));
    return res.json(rows);
  } catch (e) { next(e); }
});

/** CREATE: POST /api/admin/templates/:channel */
router.post('/:channel', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { channel } = req.params;
    const list = await getArr(req, channel);
    const body = req.body || {};

    const item = {
      id: makeId(),
      name: String(body.name || '').trim(),
      channel: channel.toLowerCase(),
      subject: body.subject != null ? String(body.subject) : null,
      body: String(body.body || ''),
      vars: Array.isArray(body.vars) ? body.vars : [],
      createdAt: now(),
      updatedAt: now(),
      createdBy: req.user?.id || null,
      updatedBy: req.user?.id || null,
    };

    list.push(item);
    await saveArr(req, channel, list);
    return res.status(201).json(item);
  } catch (e) { next(e); }
});

/** UPDATE: PUT /api/admin/templates/:channel/:id */
router.put('/:channel/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { channel, id } = req.params;
    const list = await getArr(req, channel);
    const idx = list.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const patch = req.body || {};
    const updated = {
      ...list[idx],
      ...patch,
      name: patch.name != null ? String(patch.name) : list[idx].name,
      subject: patch.subject != null ? String(patch.subject) : list[idx].subject,
      body: patch.body != null ? String(patch.body) : list[idx].body,
      vars: Array.isArray(patch.vars) ? patch.vars : list[idx].vars,
      updatedAt: now(),
      updatedBy: req.user?.id || null,
    };
    list[idx] = updated;
    await saveArr(req, channel, list);
    return res.json(updated);
  } catch (e) { next(e); }
});

/** DELETE: DELETE /api/admin/templates/:channel/:id */
router.delete('/:channel/:id', authenticateUser, ADMIN_ONLY, async (req, res, next) => {
  try {
    const { channel, id } = req.params;
    const list = await getArr(req, channel);
    const nextList = list.filter(x => String(x.id) !== String(id));
    if (nextList.length === list.length) return res.status(404).json({ error: 'Not found' });
    await saveArr(req, channel, nextList);
    return res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
