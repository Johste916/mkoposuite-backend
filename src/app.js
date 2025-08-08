// src/app.js
const express = require('express');
const app = express();
const path = require('path');

// Try optional deps so dev doesn't crash if not installed yet
let helmet, compression, morgan;
try { helmet = require('helmet'); } catch {}
try { compression = require('compression'); } catch {}
try { morgan = require('morgan'); } catch {}

app.disable('x-powered-by');
app.set('trust proxy', true);

// ---------- Security & perf ----------
if (helmet) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow serving files from /uploads
  }));
}
if (compression) app.use(compression());
if (process.env.NODE_ENV !== 'production' && morgan) app.use(morgan('dev'));

// ---------- Robust CORS (including Netlify previews) ----------
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://strong-fudge-7fc28d.netlify.app',
  'https://mkoposuite.netlify.app',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false; // non-browser/SSR requests won't send Origin; we simply don't add CORS headers
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if ((protocol === 'https:' || protocol === 'http:') && hostname.endsWith('.netlify.app')) {
      return true; // allow Netlify preview URLs
    }
  } catch (_) {}
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------- Body parsers ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------- Static files (for local attachments) ----------
// Serve from project /uploads (one level up from src)
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// ---------- Route Imports ----------
const authRoutes = require('./routes/authRoutes');
const borrowerRoutes = require('./routes/borrowerRoutes');
const loanRoutes = require('./routes/loanRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const savingsRoutes = require('./routes/savingsRoutes');
const disbursementRoutes = require('./routes/loanDisbursementRoutes');
const repaymentRoutes = require('./routes/repaymentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const settingRoutes = require('./routes/settingRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const branchRoutes = require('./routes/branchRoutes');
const userRoleRoutes = require('./routes/userRoleRoutes');
const userBranchRoutes = require('./routes/userBranchRoutes');

// ---------- Route Registrations ----------
app.use('/api/login', authRoutes);
app.use('/api/borrowers', borrowerRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/disbursements', disbursementRoutes);
app.use('/api/repayments', repaymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/user-roles', userRoleRoutes);
app.use('/api/user-branches', userBranchRoutes);

// ---------- Health ----------
app.get('/api/test', (_req, res) => res.send('✅ API is working!'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ---------- 404 handler ----------
app.use((req, res, _next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).send('Not found');
});

// ---------- Centralized error handler ----------
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.expose ? err.message : (status === 500 ? 'Internal server error' : err.message);
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('❌ Error:', err);
  }
  res.status(status).json({ error: message || 'Unexpected error' });
});

module.exports = app;
