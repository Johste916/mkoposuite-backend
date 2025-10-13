'use strict';

const router = require('express').Router();

let db = {};
try { db = require('../models'); } catch {}

let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}

// Try both possible controller filenames and normalize method names
let ctl = null;
try { ctl = require('../controllers/permissionsController'); } catch {}
if (!ctl) {
  try { ctl = require('../controllers/permissionMatrixController'); } catch {}
}

const getMatrix          = ctl?.getMatrix;
const setRolePermissions = ctl?.setRolePermissions || ctl?.saveForRole; // alias supported
const updatePermission   = ctl?.updatePermission;

router.use(authenticateUser);

/* ---------------------- Permission Matrix (for UI) ---------------------- */
// GET /api/permissions/matrix  -> { roles, catalog, matrix }
if (typeof getMatrix === 'function') {
  router.get('/matrix', getMatrix);
}

// PUT /api/permissions/role/:roleId  body: { actions: string[], mode?: "replace"|"add"|"remove" }
if (typeof setRolePermissions === 'function') {
  router.put('/role/:roleId', setRolePermissions);
}

/* --------------------------- Simple list/create/delete --------------------------- */
// List (legacy shape: {id, name, description})
router.get('/', async (_req, res, next) => {
  try {
    const items = await db.Permission.findAll({ order: [['action', 'ASC']] });
    res.json(items.map(p => ({ id: p.id, name: p.action, description: p.description })));
  } catch (e) { next(e); }
});

// Create (name -> action)
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const p = await db.Permission.create({ action: name, roles: [], description: name });
    res.json({ id: p.id, name: p.action, description: p.description });
  } catch (e) { next(e); }
});

// Delete by id
router.delete('/:id', async (req, res, next) => {
  try {
    await db.Permission.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* --------------------- Upsert-by-action endpoint --------------------- */
// PUT /api/permissions/:action  body: { roles: string[], description? }
if (typeof updatePermission === 'function') {
  router.put('/:action', updatePermission);
}

module.exports = router;
