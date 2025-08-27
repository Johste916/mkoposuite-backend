'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');

const ctrl = require('../controllers/investorController');

// Optional Settings KV (used to store attachment metadata in both DB & KV modes)
let Setting;
try {
  ({ Setting } = require('../models'));
} catch {
  const models = require('../models');
  Setting = models && models.Setting;
}

const router = express.Router();

/* ------------------------------- Uploads dir ------------------------------- */
// served by app.js: app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')))
const uploadDir = path.resolve(__dirname, '../../uploads/investors');
fs.mkdirSync(uploadDir, { recursive: true });

/* ------------------------------- Multer setup ------------------------------ */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const guessed = file.mimetype ? `.${mime.extension(file.mimetype)}` : null;
    const ext = (guessed || rawExt || '.bin').replace(/[^.\w]/g, '');
    const base = (file.originalname || 'file')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .slice(0, 80);
    cb(null, `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${base}${ext}`);
  },
});

const isImage = (m) => /^image\/(jpeg|png|webp|gif)$/.test(m || '');
const isDoc =
  (m) =>
    /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/.test(m || '');

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'photo') {
    return isImage(file.mimetype) ? cb(null, true) : cb(new Error('Photo must be an image (jpg, png, webp, gif)'));
  }
  // attachments
  return (isImage(file.mimetype) || isDoc(file.mimetype))
    ? cb(null, true)
    : cb(new Error('Unsupported file type'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

/* -------------------------- helpers: attachments KV ------------------------ */
// settings keys must match /^[A-Za-z0-9._-]+$/
const attachmentsKey = (tenantId, investorId) => {
  const t = tenantId ? `tenant_${tenantId}` : 'public';
  return `${t}_investor_${investorId}_files`;
};

async function listAttachments(tenantId, investorId) {
  if (!Setting || typeof Setting.get !== 'function') return [];
  return (await Setting.get(attachmentsKey(tenantId, investorId), [])) || [];
}

async function saveAttachments(tenantId, investorId, items, userId) {
  if (!Setting || typeof Setting.set !== 'function') return;
  await Setting.set(attachmentsKey(tenantId, investorId), items, userId, userId);
}

/* ------------------------------ middlewares -------------------------------- */
const attachPhotoUrl = (req, _res, next) => {
  if (req.file && req.file.filename) {
    // populate so controller can persist it without needing to read req.file
    req.body.photoUrl = `/uploads/investors/${req.file.filename}`;
  }
  next();
};

/* ---------------------------------- CRUD ----------------------------------- */
router.get('/', ctrl.list);
router.post('/', upload.single('photo'), attachPhotoUrl, ctrl.create);
router.get('/:id', ctrl.get);                          // align with controller.exports.get
router.put('/:id', upload.single('photo'), attachPhotoUrl, ctrl.update);
router.delete('/:id', ctrl.remove);

/* ----------------------------- related finance ----------------------------- */
router.get('/:id/transactions', ctrl.listTransactions);
router.post('/:id/deposits', ctrl.createDeposit);
router.post('/:id/withdrawals', ctrl.createWithdrawal);

/* ------------------------------- attachments ------------------------------- */
// Upload 1..10 files related to an investor (field: files[])
router.post('/:id/files', upload.array('files', 10), async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || null;
    const userId = req.user?.id || null;
    const investorId = req.params.id;

    const existing = await listAttachments(tenantId, investorId);
    const now = new Date().toISOString();

    const added = (req.files || []).map((f) => ({
      id: uuidv4(),
      name: f.originalname,
      storedName: f.filename,
      url: `/uploads/investors/${f.filename}`,
      mimetype: f.mimetype,
      size: f.size,
      uploadedAt: now,
      uploadedBy: userId || null,
    }));

    await saveAttachments(tenantId, investorId, [...existing, ...added], userId);
    return res.status(201).json({ files: added });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(400).json({ message: err.message || 'Upload failed' });
  }
});

// List files
router.get('/:id/files', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || null;
    const investorId = req.params.id;
    const items = await listAttachments(tenantId, investorId);
    return res.json({ files: items });
  } catch {
    return res.status(500).json({ message: 'Failed to load files' });
  }
});

// Delete one file (removes from KV and disk, best-effort)
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || null;
    const userId = req.user?.id || null;
    const investorId = req.params.id;
    const fileId = req.params.fileId;

    const items = await listAttachments(tenantId, investorId);
    const target = items.find((f) => String(f.id) === String(fileId));
    const next = items.filter((f) => String(f.id) !== String(fileId));

    await saveAttachments(tenantId, investorId, next, userId);

    if (target?.storedName) {
      const p = path.join(uploadDir, target.storedName);
      fs.promises.unlink(p).catch(() => {}); // ignore if already gone
    }

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: 'Failed to delete file' });
  }
});

module.exports = router;
