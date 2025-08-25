'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expensesController');
const { authenticateUser } = require('../middleware/authMiddleware');

/* ---------- Multer (CSV upload) with safe fallback ---------- */
let upload;
try {
  const m = require('multer');
  upload = m({ storage: m.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
} catch (e) {
  // Fallback middleware that errors if CSV upload is called without multer
  upload = {
    single: () => (_req, _res, next) =>
      next(Object.assign(new Error('CSV upload requires multer. Run: npm i multer'), { status: 500, expose: true })),
  };
}

/** Roles allowed */
const allowRead  = new Set(['admin', 'director', 'accountant', 'branch_manager', 'staff']);
const allowWrite = new Set(['admin', 'director', 'accountant', 'branch_manager']);

/** Helpers to normalize roles/permissions */
const norm = (v) => String(v || '').trim().toLowerCase();

function extractRoles(u) {
  const bag = [];
  if (u?.role) bag.push(u.role);
  if (Array.isArray(u?.roles)) bag.push(...u.roles);
  if (Array.isArray(u?.Roles)) bag.push(...u.Roles.map(r => r?.name || r?.code || r?.slug));
  return bag.map(norm).filter(Boolean);
}

function extractPerms(u) {
  const fromStringArray = Array.isArray(u?.permissions) ? u.permissions : null;
  const fromObjArray    = Array.isArray(u?.Permissions) ? u.Permissions : null;

  if (fromStringArray) return fromStringArray.map(norm).filter(Boolean);
  if (fromObjArray) {
    return fromObjArray
      .map(p => p?.code || p?.slug || p?.name || '')
      .map(norm)
      .filter(Boolean);
  }
  return [];
}

function canRead(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const roles = new Set(extractRoles(req.user));
  const perms = new Set(extractPerms(req.user));

  for (const r of roles) {
    if (allowRead.has(r) || allowWrite.has(r) || r === 'admin' || r === 'administrator') return next();
  }
  if (perms.has('expenses.read') || perms.has('expenses.write') || perms.has('expenses:*') || perms.has('*')) return next();

  return res.status(403).json({ error: 'Forbidden' });
}

function canWrite(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const roles = new Set(extractRoles(req.user));
  const perms = new Set(extractPerms(req.user));

  for (const r of roles) {
    if (allowWrite.has(r) || r === 'admin' || r === 'administrator') return next();
  }
  if (perms.has('expenses.write') || perms.has('expenses:*') || perms.has('*')) return next();

  return res.status(403).json({ error: 'Forbidden' });
}

// Base: /api/expenses
router.get('/',         authenticateUser, canRead,  ctrl.list);

// CSV export MUST be before :id so "export" isn't treated as an ID
router.get('/export',   authenticateUser, canRead,  ctrl.exportCsv);

router.get('/:id',      authenticateUser, canRead,  ctrl.get);
router.post('/',        authenticateUser, canWrite, ctrl.create);
router.post('/csv',     authenticateUser, canWrite, upload.single('file'), ctrl.uploadCsv);
router.put('/:id',      authenticateUser, canWrite, ctrl.update);
router.delete('/:id',   authenticateUser, canWrite, ctrl.remove);

module.exports = router;
