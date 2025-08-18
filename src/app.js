// backend/src/app.js
const express = require('express');
const path = require('path');
const app = express();

/* ------------------------------ Optional deps ------------------------------ */
let helmet, compression, morgan;
try { helmet = require('helmet'); } catch {}
try { compression = require('compression'); } catch {}
try { morgan = require('morgan'); } catch {}

/* ---------------------------- App base settings ---------------------------- */
app.disable('x-powered-by');
app.set('trust proxy', true);

/* -------------------------- Security & performance ------------------------- */
if (helmet) {
  // Allow serving uploaded files cross-origin (for Netlify/Vite dev)
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
}
if (compression) app.use(compression());
if (process.env.NODE_ENV !== 'production' && morgan) app.use(morgan('dev'));

/* ----------------------------------- CORS ---------------------------------- */
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'https://strong-fudge-7fc28d.netlify.app',
  'https://mkoposuite.netlify.app',
];
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...extraOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if ((protocol === 'https:' || protocol === 'http:') && hostname.endsWith('.netlify.app')) {
      return true;
    }
  } catch {}
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* --------------------------------- Parsers --------------------------------- */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ----------------------------- Static /uploads ----------------------------- */
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));

/* ------------------------ Helpers: safe route loading ----------------------- */
function makeDummyRouter(sample) {
  const r = express.Router();
  r.get('/', (_req, res) => res.json(sample));
  r.get('/:id', (req, res) => {
    const id = Number(req.params.id) || req.params.id;
    if (Array.isArray(sample)) {
      const found = sample.find(x => String(x.id) === String(id)) || sample[0] || null;
      return res.json(found);
    }
    return res.json(sample);
  });
  return r;
}
function safeLoadRoutes(routePath, dummyRouter) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(routePath);
    return mod && mod.default ? mod.default : mod;
  } catch (e) {
    const pretty = routePath.replace(__dirname, '…');
    console.warn(`⚠️  Using dummy routes for ${pretty} — create this file to enable real API.`);
    return dummyRouter;
  }
}

/* --------------------------------- Routes ---------------------------------- */
/* Existing, already in your project */
const authRoutes          = require('./routes/authRoutes');
const borrowerRoutes      = require('./routes/borrowerRoutes');
const loanRoutes          = require('./routes/loanRoutes');
const dashboardRoutes     = require('./routes/dashboardRoutes');
const savingsRoutes       = require('./routes/savingsRoutes');
const disbursementRoutes  = require('./routes/loanDisbursementRoutes');
const repaymentRoutes     = require('./routes/repaymentRoutes');
const reportRoutes        = require('./routes/reportRoutes');
const settingRoutes       = require('./routes/settingRoutes');
const userRoutes          = require('./routes/userRoutes');
const roleRoutes          = require('./routes/roleRoutes');
const branchRoutes        = require('./routes/branchRoutes');
const userRoleRoutes      = require('./routes/userRoleRoutes');
const userBranchRoutes    = require('./routes/userBranchRoutes');
const loanProductRoutes   = require('./routes/loanProductRoutes');

/* Admin modules */
const adminStaffRoutes        = require('./routes/staffRoutes');
const permissionRoutes        = require('./routes/permissionRoutes');
const adminAuditRoutes        = require('./routes/admin/auditRoutes');
const adminReportSubRoutes    = require('./routes/admin/reportSubscriptionRoutes');

/* New modules (LoanDisk parity) — try to load real files, else mount dummy */
const collateralRoutes = safeLoadRoutes(
  './routes/collateralRoutes',
  makeDummyRouter([
    { id: 1, borrower: 'John Doe', item: 'Laptop', model: 'Dell', status: 'Active' },
    { id: 2, borrower: 'Jane Smith', item: 'Car', model: 'Toyota', status: 'Released' },
  ])
);
const collectionSheetsRoutes = safeLoadRoutes(
  './routes/collectionSheetsRoutes',
  makeDummyRouter([
    { id: 1, type: 'daily', date: '2025-08-01', count: 12 },
    { id: 2, type: 'missed', date: '2025-08-02', count: 5 },
  ])
);
const savingsTransactionsRoutes = safeLoadRoutes(
  './routes/savingsTransactionsRoutes',
  makeDummyRouter([
    { id: 1, borrower: 'John Doe', type: 'deposit', amount: 150, date: '2025-08-01' },
    { id: 2, borrower: 'Jane Smith', type: 'withdrawal', amount: 80, date: '2025-08-03' },
  ])
);
const investorsRoutes = safeLoadRoutes(
  './routes/investorsRoutes',
  makeDummyRouter([
    { id: 1, name: 'Alpha Capital', phone: '255700000001', products: 2 },
    { id: 2, name: 'Beta Partners', phone: '255700000002', products: 1 },
  ])
);
const esignaturesRoutes = safeLoadRoutes(
  './routes/esignaturesRoutes',
  makeDummyRouter([
    { id: 1, name: 'Loan Agreement #1', sent: '2025-08-01', status: 'Signed' },
    { id: 2, name: 'Loan Agreement #2', sent: '2025-08-03', status: 'Pending' },
  ])
);
const payrollRoutes = safeLoadRoutes(
  './routes/payrollRoutes',
  makeDummyRouter([
    { id: 1, period: '2025-07', staffCount: 8, total: 4200000 },
    { id: 2, period: '2025-08', staffCount: 9, total: 4450000 },
  ])
);
const expensesRoutes = safeLoadRoutes(
  './routes/expensesRoutes',
  makeDummyRouter([
    { id: 1, type: 'Office Rent', amount: 900000, date: '2025-08-01' },
    { id: 2, type: 'Fuel', amount: 120000, date: '2025-08-04' },
  ])
);
const otherIncomeRoutes = safeLoadRoutes(
  './routes/otherIncomeRoutes',
  makeDummyRouter([
    { id: 1, source: 'Training Fees', amount: 250000, date: '2025-08-02' },
    { id: 2, source: 'Sale of Scrap', amount: 60000, date: '2025-08-05' },
  ])
);
const assetManagementRoutes = safeLoadRoutes(
  './routes/assetManagementRoutes',
  makeDummyRouter([
    { id: 1, name: 'Branch Laptop 01', category: 'Electronics', status: 'In Use' },
    { id: 2, name: 'Motorcycle 02', category: 'Vehicle', status: 'Maintenance' },
  ])
);
const accountingRoutes = safeLoadRoutes(
  './routes/accountingRoutes',
  makeDummyRouter({
    cashflowMonthly: [
      { month: 'Jan', inflow: 5000000, outflow: 3200000 },
      { month: 'Feb', inflow: 6200000, outflow: 4100000 },
    ],
    trialBalance: [{ account: '1000 Cash', debit: 1200000, credit: 0 }],
  })
);

/* -------------------------- Automatic audit hooks -------------------------- */
/* Lazy-access AuditLog so we don't break if model is missing */
let AuditLog;
try { ({ AuditLog } = require('./models')); } catch {}

/**
 * Records successful non-GET API calls (POST/PUT/PATCH/DELETE).
 * Skips OPTIONS, static, healthchecks, and the audit endpoints themselves.
 * Uses req.user if set by downstream authenticateUser middleware.
 */
app.use((req, res, next) => {
  res.on('finish', () => {
    try {
      if (!AuditLog || typeof AuditLog.create !== 'function') return;
      if (!req.path.startsWith('/api/')) return;
      if (req.method === 'GET' || req.method === 'OPTIONS') return;
      if (req.path.startsWith('/api/admin/audit') || req.path.startsWith('/api/audit-logs')) return;
      if (req.path.startsWith('/uploads')) return;

      const ok = res.statusCode >= 200 && res.statusCode < 400;
      if (!ok) return;

      const category = (req.path.split('/')[2] || 'api').toLowerCase();
      AuditLog.create({
        userId:   req.user?.id || null,
        branchId: req.user?.branchId || null,
        category,
        action: `${req.method} ${req.path}`,
        message: '',
        ip: req.ip,
        reversed: false,
      }).catch(() => {});
    } catch { /* no-op */ }
  });
  next();
});

/* --------------------------------- Mounting -------------------------------- */
app.use('/api/login',          authRoutes);
app.use('/api/borrowers',      borrowerRoutes);
app.use('/api/loans',          loanRoutes);
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/savings',        savingsRoutes);
app.use('/api/disbursements',  disbursementRoutes);
app.use('/api/repayments',     repaymentRoutes);
app.use('/api/reports',        reportRoutes);
app.use('/api/settings',       settingRoutes);

/* Admin/ACL */
app.use('/api/admin/staff',                 adminStaffRoutes);
app.use('/api/permissions',                 permissionRoutes);
app.use('/api/admin/audit',                 adminAuditRoutes);
/* alias for current frontend (AuditManagement.jsx calls /audit-logs) */
app.use('/api/audit-logs',                  adminAuditRoutes);

/* Other core mounts */
app.use('/api/users',          userRoutes);
app.use('/api/roles',          roleRoutes);
app.use('/api/branches',       branchRoutes);
app.use('/api/user-roles',     userRoleRoutes);
app.use('/api/user-branches',  userBranchRoutes);
app.use('/api/loan-products',  loanProductRoutes);

/* New modules (work with real route files OR dummy routers) */
app.use('/api/collateral',           collateralRoutes);
app.use('/api/collections',          collectionSheetsRoutes);
app.use('/api/savings-transactions', savingsTransactionsRoutes);
app.use('/api/investors',            investorsRoutes);
app.use('/api/esignatures',          esignaturesRoutes);
app.use('/api/payroll',              payrollRoutes);
app.use('/api/expenses',             expensesRoutes);
app.use('/api/other-income',         otherIncomeRoutes);
app.use('/api/assets',               assetManagementRoutes);
app.use('/api/accounting',           accountingRoutes);

/* -------------------------------- Healthchecks ----------------------------- */
app.get('/api/test',   (_req, res) => res.send('✅ API is working!'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// DB health (helps diagnose 500s quickly)
try {
  const { sequelize } = require('./models');
  app.get('/api/health/db', async (_req, res) => {
    try {
      await sequelize.authenticate();
      res.json({ db: 'ok', ts: new Date().toISOString() });
    } catch (e) {
      console.error('DB health error:', e);
      res.status(500).json({ db: 'down', error: e.message });
    }
  });
} catch { /* ignore */ }

/* ----------------------------------- 404 ----------------------------------- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).send('Not found');
});

/* ------------------------------- Error handler ----------------------------- */
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.expose ? err.message : (status === 500 ? 'Internal server error' : err.message);
  if (process.env.NODE_ENV !== 'production') console.error('❌ Error:', err);
  res.status(status).json({ error: message || 'Unexpected error' });
});

module.exports = app;
