'use strict';
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
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
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

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'X-User-Id',
  // custom headers used by your frontend
  'x-tenant-id',
  'x-branch-id',
  'x-timezone',
  'x-tz-offset',
  'Accept',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Vary ensures caches don’t mix responses for different origins/headers
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');

  // Echo requested headers if present; otherwise send our defaults
  const requested = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested && String(requested).trim().length
      ? requested
      : DEFAULT_ALLOWED_HEADERS.join(', ')
  );

  // Let browser read filename on downloads
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

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

function safeLoadRoutes(relPathFromSrc, dummyRouter) {
  const tryPaths = [relPathFromSrc, relPathFromSrc.replace('./', '../')];
  for (const p of tryPaths) {
    try {
      const mod = require(p);
      return mod && mod.default ? mod.default : mod;
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn(`⚠️  Failed loading ${p}: ${e.message}`);
      }
    }
  }
  const pretty = relPathFromSrc.replace(__dirname, '…');
  console.warn(`⚠️  Using dummy routes for ${pretty} — create this file to enable real API.`);
  return dummyRouter;
}

/* --------------------------------- Routes ---------------------------------- */
const authRoutes          = safeLoadRoutes('./routes/authRoutes', makeDummyRouter({ ok: true }));

// IMPORTANT: dedicate a small router for borrower search and mount it BEFORE /api/borrowers
const borrowerSearchRoutes = safeLoadRoutes('./routes/borrowerSearchRoutes', makeDummyRouter([]));
const borrowerRoutes      = safeLoadRoutes('./routes/borrowerRoutes', makeDummyRouter([]));

const loanRoutes          = safeLoadRoutes('./routes/loanRoutes', makeDummyRouter([]));
const dashboardRoutes     = safeLoadRoutes('./routes/dashboardRoutes', makeDummyRouter({}));
const savingsRoutes       = safeLoadRoutes('./routes/savingsRoutes', makeDummyRouter([]));
const disbursementRoutes  = safeLoadRoutes('./routes/loanDisbursementRoutes', makeDummyRouter([]));
const repaymentRoutes     = safeLoadRoutes('./routes/repaymentRoutes', makeDummyRouter([]));
const reportRoutes        = safeLoadRoutes('./routes/reportRoutes', makeDummyRouter({}));
const settingRoutes       = safeLoadRoutes('./routes/settingRoutes', makeDummyRouter({}));
const userRoutes          = safeLoadRoutes('./routes/userRoutes', makeDummyRouter([]));
const roleRoutes          = safeLoadRoutes('./routes/roleRoutes', makeDummyRouter([]));
const branchRoutes        = safeLoadRoutes('./routes/branchRoutes', makeDummyRouter([]));
const userRoleRoutes      = safeLoadRoutes('./routes/userRoleRoutes', makeDummyRouter([]));
const userBranchRoutes    = safeLoadRoutes('./routes/userBranchRoutes', makeDummyRouter([]));
const loanProductRoutes   = safeLoadRoutes('./routes/loanProductRoutes', makeDummyRouter([]));

/* Admin modules */
const adminStaffRoutes     = safeLoadRoutes('./routes/staffRoutes', makeDummyRouter([]));
const permissionRoutes     = safeLoadRoutes('./routes/permissionRoutes', makeDummyRouter([]));
const adminAuditRoutes     = safeLoadRoutes('./routes/admin/auditRoutes', makeDummyRouter([]));
const adminReportSubRoutes = safeLoadRoutes('./routes/admin/reportSubscriptionRoutes', makeDummyRouter([]));

/* New modules — try to load real files, else mount dummy */
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
    { id: 1, type: 'FIELD', date: '2025-08-01', status: 'PENDING' },
    { id: 2, type: 'OFFICE', date: '2025-08-02', status: 'COMPLETED' },
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
let AuditLog;
try { ({ AuditLog } = require('./models')); } catch {
  try { ({ AuditLog } = require('../models')); } catch {}
}

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
// borrower search must come BEFORE /api/borrowers to avoid /:id catching "search"
app.use('/api/borrowers/search', borrowerSearchRoutes);

app.use('/api/login',          authRoutes);
app.use('/api/borrowers',      borrowerRoutes);
app.use('/api/loans',          loanRoutes);
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/savings',        savingsRoutes);                   // base savings (create + borrower summary)
app.use('/api/savings/transactions', savingsTransactionsRoutes); // combined module under /savings
app.use('/api/disbursements',  disbursementRoutes);
app.use('/api/repayments',     repaymentRoutes);
app.use('/api/reports',        reportRoutes);
app.use('/api/settings',       settingRoutes);

/* Admin/ACL */
app.use('/api/admin/staff',     adminStaffRoutes);
app.use('/api/permissions',     permissionRoutes);
app.use('/api/admin/audit',     adminAuditRoutes);
app.use('/api/audit-logs',      adminAuditRoutes);
app.use('/api/admin/report-subscriptions', adminReportSubRoutes);

/* Other core mounts */
app.use('/api/users',          userRoutes);
app.use('/api/roles',          roleRoutes);
app.use('/api/branches',       branchRoutes);
app.use('/api/user-roles',     userRoleRoutes);
app.use('/api/user-branches',  userBranchRoutes);
app.use('/api/loan-products',  loanProductRoutes);

/* New modules (real routes OR dummy routers) */
app.use('/api/collateral',           collateralRoutes);
app.use('/api/collections',          collectionSheetsRoutes);
app.use('/api/savings-transactions', savingsTransactionsRoutes); // legacy path kept for back-compat
app.use('/api/investors',            investorsRoutes);
app.use('/api/esignatures',          esignaturesRoutes);
app.use('/api/payroll',              payrollRoutes);
app.use('/api/expenses',             expensesRoutes);
app.use('/api/other-income',         otherIncomeRoutes);
app.use('/api/assets',               assetManagementRoutes);
app.use('/api/accounting',           accountingRoutes);

/* ---------- Temporary stub to silence 404s on entitlements (optional) ------ */
app.get('/api/tenants/me/entitlements', (_req, res) => {
  res.json({ modules: {}, status: 'ok' });
});

/* -------------------------------- Healthchecks ----------------------------- */
app.get('/api/test',   (_req, res) => res.send('✅ API is working!'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

try {
  let sequelize;
  try { ({ sequelize } = require('./models')); } catch { ({ sequelize } = require('../models')); }
  if (sequelize) {
    app.get('/api/health/db', async (_req, res) => {
      try {
        await sequelize.authenticate();
        res.json({ db: 'ok', ts: new Date().toISOString() });
      } catch (e) {
        console.error('DB health error:', e);
        res.status(500).json({ db: 'down', error: e.message });
      }
    });
  }
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

const accountRoutes = require('./routes/accountRoutes');
app.use('/api/account', accountRoutes);

module.exports = app;