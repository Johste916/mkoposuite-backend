// backend/src/routes/hrRoutes.js
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

let models = null;
try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

const DATA_DIR = path.resolve(__dirname, '../../uploads/devdata');
fs.mkdirSync(DATA_DIR, { recursive: true });
const EMP_FILE = path.join(DATA_DIR, 'employees.json');
const LEAVE_FILE = path.join(DATA_DIR, 'leaves.json');
const CONTRACTS_FILE = path.join(DATA_DIR, 'contracts.json');

// simple JSON persistence for dev (so refreshes keep data)
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

const up = {
  employees: readJSON(EMP_FILE, []),
  leaves: readJSON(LEAVE_FILE, []),
  contracts: readJSON(CONTRACTS_FILE, []),
};

function nextId(list) {
  return (list.length ? Math.max(...list.map(x => Number(x.id) || 0)) : 0) + 1;
}

/* --------------------------- EMPLOYEES --------------------------- */
router.get('/employees', async (_req, res) => {
  if (models?.Employee?.findAll) {
    try {
      const rows = await models.Employee.findAll({ order: [['createdAt', 'DESC']] });
      return res.json(rows);
    } catch (e) {
      // table missing -> fall back
    }
  }
  return res.json(up.employees);
});

router.post('/employees', async (req, res) => {
  const { firstName = '', lastName = '', email = '', role = 'staff', baseSalary = 0 } = req.body || {};
  if (models?.Employee?.create) {
    try {
      const row = await models.Employee.create({ firstName, lastName, email, role, baseSalary });
      return res.status(201).json(row);
    } catch (e) {
      // fall through to memory if table missing
    }
  }
  const row = { id: nextId(up.employees), firstName, lastName, email, role, baseSalary: Number(baseSalary)||0, createdAt: new Date().toISOString() };
  up.employees.unshift(row);
  writeJSON(EMP_FILE, up.employees);
  res.status(201).json(row);
});

/* ----------------------------- LEAVE ----------------------------- */
// support /leave, /leaves, /leave-requests (the UI may hit any)
const leaveListPaths = ['/leave', '/leaves', '/leave-requests'];
leaveListPaths.forEach(p => {
  router.get(p, async (_req, res) => {
    if (models?.LeaveRequest?.findAll) {
      try {
        const rows = await models.LeaveRequest.findAll({ order: [['createdAt','DESC']] });
        return res.json(rows);
      } catch (e) {}
    }
    return res.json(up.leaves);
  });
});

router.post(['/leave', '/leaves', '/leave-requests'], async (req, res) => {
  const { type, from, to, paid = true, reason = '' } = req.body || {};
  if (models?.LeaveRequest?.create) {
    try {
      const row = await models.LeaveRequest.create({ type, from, to, paid: !!paid, reason, status: 'PENDING' });
      return res.status(201).json(row);
    } catch (e) {}
  }
  const row = { id: nextId(up.leaves), type, from, to, paid: !!paid, reason, status: 'PENDING', createdAt: new Date().toISOString() };
  up.leaves.unshift(row);
  writeJSON(LEAVE_FILE, up.leaves);
  res.status(201).json(row);
});

/* --------------------------- CONTRACTS --------------------------- */
const multer = require('multer');
const contractsDir = path.resolve(__dirname, '../../uploads/contracts');
fs.mkdirSync(contractsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, contractsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage });

router.get('/contracts', async (_req, res) => {
  if (models?.Contract?.findAll) {
    try {
      const rows = await models.Contract.findAll({ order: [['createdAt','DESC']] });
      return res.json(rows);
    } catch (e) {}
  }
  return res.json(up.contracts);
});

router.post('/contracts', upload.single('file'), async (req, res) => {
  const { employeeId, title, startDate, endDate } = req.body || {};
  const filePath = req.file ? `/uploads/contracts/${req.file.filename}` : null;
  const status = (endDate && new Date(endDate) < new Date()) ? 'EXPIRED' : 'ACTIVE';

  if (models?.Contract?.create) {
    try {
      const row = await models.Contract.create({ employeeId, title, startDate, endDate, status, fileUrl: filePath });
      return res.status(201).json(row);
    } catch (e) {}
  }
  const row = { id: nextId(up.contracts), employeeId, title, startDate, endDate, status, fileUrl: filePath, createdAt: new Date().toISOString() };
  up.contracts.unshift(row);
  writeJSON(CONTRACTS_FILE, up.contracts);
  res.status(201).json(row);
});

module.exports = router;
