// src/middleware/upload.js
const fs = require('fs');
const multer = require('multer');
const path = require('path');

// Where to store uploads (defaults to ./uploads)
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

// Ensure the directory exists at boot
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Disk storage with safe, readable filenames
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_') // sanitize
      .slice(0, 80); // keep filenames short
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

// Only allow CSV/TXT (covers common CSV mimetypes)
const allowedExts = new Set(['.csv', '.txt']);
const allowedMimes = new Set([
  'text/csv',
  'application/vnd.ms-excel', // some browsers/OSes use this for CSV
  'text/plain',
]);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.has(ext) || allowedMimes.has(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('Only CSV or TXT files are allowed.'));
};

// Default 5 MB max; override via UPLOAD_MAX_SIZE (bytes)
const limits = {
  fileSize: Number(process.env.UPLOAD_MAX_SIZE || 5 * 1024 * 1024),
};

module.exports = multer({ storage, fileFilter, limits });
