// backend/src/routes/uploadRoutes.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { authenticateUser } = require('../middleware/authMiddleware');

const uploadsDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'upload', ext).replace(/[^a-z0-9_-]/gi, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ok = /image\/(png|jpe?g|webp|gif|svg\+xml)/i.test(file.mimetype);
  cb(ok ? null : new Error('Only image files are allowed'), ok);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

/** POST /api/uploads/image  (field: file) */
router.post('/image', authenticateUser, upload.single('file'), (req, res) => {
  const filename = req.file?.filename;
  if (!filename) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${filename}`; // static-served by app.js
  res.json({ url });
});

module.exports = router;
