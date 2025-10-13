'use strict';

const router = require('express').Router();

let db = {};
try { db = require('../models'); } catch {}

let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}

// Optional controllers (loaded if present)
let basicCtl = {};
try { basicCtl = require('../controllers/permissionsController'); } catch {}

let matrixCtl = {};
try { matrixCtl = require('../controllers/permissionMatrixController'); } catch {}

router.use(authenticateUser);

/* ---------------------- Permission Matrix (for UI) ---------------------- */
// GET /api/permissions/matrix  -> { roles, matrix }
if (typeof matrixCtl.getMatrix === 'function') {
  router.get('/matrix', matrixCtl.getMatrix);
} else {
  router.get('/matrix', (_req, res) =>
    res.status(501).json({ error: 'permissionMatrixController.getMatrix not available' })
  );
}

// PUT /api/permissions/role/:roleId  body: { actions: string[], mode?: "replace"|"merge" }
if (typeof matrixCtl.saveForRole === 'function') {
  router.put('/role/:roleId', matrixCtl.saveForRole);
} else {
  router.put('/role/:roleId', (_req, res) =>
    res.status(501).json({ error: 'permissionMatrixController.saveForRole not available' })
  );
}

/* --------------------------- Simple list/create/delete --------------------------- */
// List (keeps your original response shape: {id, name, description})
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

/* --------------------- (Optional) upsert-by-action endpoint --------------------- */
// PUT /api/permissions/:action  body: { roles: string[], description? }
if (typeof basicCtl.updatePermission === 'function') {
  router.put('/:action', basicCtl.updatePermission);
}

module.exports = router;
