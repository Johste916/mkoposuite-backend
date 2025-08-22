const fs = require('fs');
const multer = require('multer');
const path = require('path');

// Where to store uploads if/when using disk storage (defaults to ./uploads)
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

// Ensure the directory exists (for disk mode only)
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Disk storage with safe, readable filenames
const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_') // sanitize
      .slice(0, 80);
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

// Memory storage is ideal for your repayments CSV endpoint (controller reads req.file.buffer)
const memoryUpload = multer({ storage: multer.memoryStorage(), fileFilter, limits });
// Disk upload remains available for other modules that prefer a file on disk
const diskUpload = multer({ storage: diskStorage, fileFilter, limits });

// Choose default by env; default to memory to match /repayments/csv handler
const defaultMode = (process.env.UPLOAD_STORAGE || 'memory').toLowerCase();
const upload = defaultMode === 'disk' ? diskUpload : memoryUpload;

// Backward-compatible default export, plus named exports if you want to opt-in per route
module.exports = upload;
module.exports.memory = memoryUpload;
module.exports.disk = diskUpload;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
