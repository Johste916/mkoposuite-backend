'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();

/* ------------------------------ Optional deps ------------------------------ */
let helmet, compression, morgan, rateLimit;
try { helmet = require('helmet'); } catch {}
try { compression = require('compression'); } catch {}
try { morgan = require('morgan'); } catch {}
try { rateLimit = require('express-rate-limit'); } catch {}

/* ---------------------------- App base settings ---------------------------- */
app.disable('x-powered-by');
app.set('trust proxy', true);

/* -------------------------- Attach models for controllers ------------------ */
let models;
try { models = require('./models'); } catch { try { models = require('../models'); } catch {} }
if (models) app.set('models', models);

/* ------------------------------- App context ------------------------------- */
/** Basic request context so controllers can read consistent metadata */
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID?.() || String(Date.now());
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  // multi-tenant helpers (soft)
  req.context = {
    tenantId: req.headers['x-tenant-id'] || null,
    branchId: req.headers['x-branch-id'] || null,
    tz: req.headers['x-timezone'] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    tzOffset: req.headers['x-tz-offset'] || null,
  };
  next();
});

/* -------------------------- Security & performance ------------------------- */
if (helmet) app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
if (compression) app.use(compression());
if (process.env.NODE_ENV !== 'production' && morgan) app.use(morgan('dev'));

// Optional basic rate-limiting for public APIs (safe defaults)
if (rateLimit) {
  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 120),
    standardHeaders: true,
    legacyHeaders: false,
  }));
}

/* ----------------------------------- CORS ---------------------------------- */
const defaultOrigins = [
  'http://localhost:5173','http://127.0.0.1:5173',
  'http://localhost:4173','http://127.0.0.1:4173',
  'http://localhost:3000','http://127.0.0.1:3000',
  'https://strong-fudge-7fc28d.netlify.app','https://mkoposuite.netlify.app',
];
// Support both CORS_ORIGINS and CORS_ALLOW_ORIGINS and FRONTEND_URL
const envOrigins = [
  ...(process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
];
const allowedOrigins = new Set([...defaultOrigins, ...envOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    // any Netlify preview/site
    if ((protocol === 'https:' || protocol === 'http:') && hostname.endsWith('.netlify.app')) return true;
  } catch {}
  return false;
}

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type','Authorization','X-Requested-With','X-User-Id',
  'x-tenant-id','x-branch-id','x-timezone','x-tz-offset','x-request-id','Accept',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');

  const requested = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested && String(requested).trim().length ? requested : DEFAULT_ALLOWED_HEADERS.join(', ')
  );

  // Let browser read filename on downloads + counts for tables
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition,X-Total-Count');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* --------------------------------- Parsers --------------------------------- */
app.use(express.json({ limit: '20mb' })); // bump a bit for payroll imports
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

/* ----------------------------- Static /uploads ----------------------------- */
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));

/* -------------------------- Small response helpers ------------------------- */
app.use((req, res, next) => {
  res.ok = (data, extra = {}) => {
    if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
    if (extra.filename) {
      res.setHeader('Content-Disposition', `attachment; filename="${extra.filename}"`);
    }
    return res.json(data);
  };
  res.fail = (status, message, extra = {}) => res.status(status).json({ error: message, ...extra });
  next();
});

/* ------------------------ Helpers: safe route loading ----------------------- */
function makeDummyRouter(sample) {
  const r = express.Router();

  // list (with total count)
  r.get('/', (_req, res) => {
    if (Array.isArray(sample)) {
      res.setHeader('X-Total-Count', String(sample.length));
      return res.json(sample);
    }
    return res.json(sample);
  });

  // basic show
  r.get('/:id', (req, res) => {
    const id = String(req.params.id);
    if (Array.isArray(sample)) {
      const found = sample.find(x => String(x.id) === id) || null;
      return res.json(found);
    }
    return res.json(sample);
  });

  // write ops are no-ops on dummy routers (helps frontends proceed)
  r.post('/', (req, res) => res.status(201).json({ ...req.body, id: Date.now() }));
  r.put('/:id', (req, res) => res.json({ id: req.params.id, ...req.body }));
  r.delete('/:id', (_req, res) => res.status(204).end());

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
  console.warn(`⚠️  Using dummy routes for ${relPathFromSrc} — create this file to enable real API.`);
  return dummyRouter;
}

/* --------------------------------- Routes ---------------------------------- */
// Auth must exist
let authRoutes;
try {
  authRoutes = require('./routes/authRoutes');
} catch (e) {
  console.error('FATAL: Failed to load ./routes/authRoutes.', e);
  throw e;
}

/** Optional core */
const accountRoutes         = safeLoadRoutes('./routes/accountRoutes', makeDummyRouter({ settings: {} }));

// Borrower search BEFORE /api/borrowers
const borrowerSearchRoutes  = safeLoadRoutes('./routes/borrowerSearchRoutes', makeDummyRouter([]));
const borrowerRoutes        = safeLoadRoutes('./routes/borrowerRoutes', makeDummyRouter([]));

const loanRoutes            = safeLoadRoutes('./routes/loanRoutes', makeDummyRouter([]));
const dashboardRoutes       = safeLoadRoutes('./routes/dashboardRoutes', makeDummyRouter({}));
const savingsRoutes         = safeLoadRoutes('./routes/savingsRoutes', makeDummyRouter([]));
const disbursementRoutes    = safeLoadRoutes('./routes/loanDisbursementRoutes', makeDummyRouter([]));
const repaymentRoutes       = safeLoadRoutes('./routes/repaymentRoutes', makeDummyRouter([]));

/** Reports router (complete set) */
const reportRoutes          = safeLoadRoutes('./routes/reportRoutes', makeDummyRouter({}));

const settingRoutes         = safeLoadRoutes('./routes/settingRoutes', makeDummyRouter({}));
const userRoutes            = safeLoadRoutes('./routes/userRoutes', makeDummyRouter([]));
const roleRoutes            = safeLoadRoutes('./routes/roleRoutes', makeDummyRouter([]));
const branchRoutes          = safeLoadRoutes('./routes/branchRoutes', makeDummyRouter([]));
const userRoleRoutes        = safeLoadRoutes('./routes/userRoleRoutes', makeDummyRouter([]));
const userBranchRoutes      = safeLoadRoutes('./routes/userBranchRoutes', makeDummyRouter([]));
const loanProductRoutes     = safeLoadRoutes('./routes/loanProductRoutes', makeDummyRouter([]));

/* Admin modules */
const adminStaffRoutes      = safeLoadRoutes('./routes/staffRoutes', makeDummyRouter([]));
const permissionRoutes      = safeLoadRoutes('./routes/permissionRoutes', makeDummyRouter([]));
const adminAuditRoutes      = safeLoadRoutes('./routes/admin/auditRoutes', makeDummyRouter([]));
const adminReportSubRoutes  = safeLoadRoutes('./routes/admin/reportSubscriptionRoutes', makeDummyRouter([]));

/* New modules — optional/dummy-friendly */
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

/* Investors */
const investorRoutes = safeLoadRoutes(
  './routes/investorRoute',
  makeDummyRouter([
    { id: 1, name: 'Alpha Capital', phone: '255700000001', shares: 10000, totalContribution: 45000000 },
    { id: 2, name: 'Beta Partners', phone: '255700000002', shares: 5500,  totalContribution: 22000000 },
  ])
);

/* E-signatures / Payroll / HR / Expenses / Other Income / Assets / Billing */
const esignaturesRoutes = safeLoadRoutes('./routes/esignaturesRoutes', makeDummyRouter([
  { id: 1, name: 'Loan Agreement #1', sent: '2025-08-01', status: 'Signed' },
  { id: 2, name: 'Loan Agreement #2', sent: '2025-08-03', status: 'Pending' },
]));
const payrollRoutes = safeLoadRoutes('./routes/payrollRoutes', makeDummyRouter([
  { id: 1, period: '2025-07', staffCount: 8, total: 4200000 },
  { id: 2, period: '2025-08', staffCount: 9, total: 4450000 },
]));
const hrRoutes = safeLoadRoutes('./routes/hrRoutes', makeDummyRouter({ employees: [] }));
const expensesRoutes = safeLoadRoutes('./routes/expensesRoutes', makeDummyRouter([
  { id: 1, type: 'Office Rent', amount: 900000, date: '2025-08-01' },
  { id: 2, type: 'Fuel', amount: 120000, date: '2025-08-04' },
]));
const otherIncomeRoutes = safeLoadRoutes('./routes/otherIncomeRoutes', makeDummyRouter([
  { id: 1, source: 'Training Fees', amount: 250000, date: '2025-08-02' },
  { id: 2, source: 'Sale of Scrap', amount: 60000, date: '2025-08-05' },
]));
const assetManagementRoutes = safeLoadRoutes('./routes/assetManagementRoutes', makeDummyRouter([
  { id: 1, name: 'Branch Laptop 01', category: 'Electronics', status: 'In Use' },
  { id: 2, name: 'Motorcycle 02', category: 'Vehicle', status: 'Maintenance' },
]));
const billingRoutes = safeLoadRoutes('./routes/billingRoutes', makeDummyRouter({ plan: 'free', status: 'active', invoices: [] }));

// Prefer real accounting routes; fallback remains available for local dev.
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
try { ({ AuditLog } = require('./models')); } catch { try { ({ AuditLog } = require('../models')); } catch {} }

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

/* ----------------------------- Branch fallback ----------------------------- */
let sequelize;
try { ({ sequelize } = require('./models')); } catch { try { ({ sequelize } = require('../models')); } catch {} }
if (sequelize) {
  app.get('/api/branches', async (_req, res, next) => {
    try {
      const [rows] = await sequelize.query('SELECT id, name, code FROM "public"."branches" ORDER BY name ASC;');
      return res.json(rows);
    } catch (e) { return next(); }
  });
}

/* --------------------------------- Mounting -------------------------------- */
// borrower search must come BEFORE /api/borrowers
app.use('/api/borrowers/search', borrowerSearchRoutes);

// Auth FIRST
app.use('/api/auth',   authRoutes);
app.use('/api/login',  authRoutes);

app.use('/api/account', accountRoutes);

app.use('/api/borrowers',      borrowerRoutes);
app.use('/api/loans',          loanRoutes);
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/savings',        savingsRoutes);
app.use('/api/savings/transactions', savingsTransactionsRoutes);
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

/* New modules */
app.use('/api/collateral',           collateralRoutes);
app.use('/api/collections',          collectionSheetsRoutes);
app.use('/api/savings-transactions', savingsTransactionsRoutes);
app.use('/api/investors',            investorRoutes);
app.use('/api/esignatures',          esignaturesRoutes);

/* HR & Payroll: mount BOTH styles for compatibility with frontend */
app.use('/api/hr',                   hrRoutes);        // e.g. /api/hr/employees, /api/hr/leave, /api/hr/contracts
app.use('/api/hr/payroll',           payrollRoutes);   // new, namespaced under HR
app.use('/api/payroll',              payrollRoutes);   // legacy path still supported

app.use('/api/expenses',             expensesRoutes);
app.use('/api/other-income',         otherIncomeRoutes);
app.use('/api/assets',               assetManagementRoutes);
app.use('/api/billing',              billingRoutes);

/* --- REAL accounting endpoints (controllers) --- */
app.use('/api/accounting',           accountingRoutes);

/* ---------- Misc: metadata & entitlements stubs ---------------------------- */
app.get('/api/meta', (_req, res) => {
  res.json({
    name: 'MkopoSuite API',
    version: process.env.APP_VERSION || 'dev',
    commit: process.env.GIT_COMMIT || undefined,
    time: new Date().toISOString(),
  });
});
app.get('/api/tenants/me/entitlements', (_req, res) => {
  res.json({ modules: {}, status: 'ok' });
});

/* -------------------------------- Healthchecks ----------------------------- */
app.get('/api/test',   (_req, res) => res.send('✅ API is working!'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// DB health + missing tables check (helps with “Required table is missing”)
try {
  let sequelize2;
  try { ({ sequelize: sequelize2 } = require('./models')); } catch { ({ sequelize: sequelize2 } = require('../models')); }
  if (sequelize2) {
    app.get('/api/health/db', async (_req, res) => {
      try {
        await sequelize2.authenticate();
        res.json({ db: 'ok', ts: new Date().toISOString() });
      } catch (e) {
        console.error('DB health error:', e);
        res.status(500).json({ db: 'down', error: e.message });
      }
    });

    // Opinionated list of HR/Payroll tables you likely need
    app.get('/api/health/db/hr-tables', async (_req, res) => {
      const expected = [
        // Employees core
        'employees','employee_roles','employee_contracts',
        // Leave
        'leave_types','leave_requests',
        // Attendance (optional)
        'attendances',
        // Payroll
        'payroll_runs','payroll_items','payroll_components',
        // Attachments (optional)
        'employee_documents',
      ];
      try {
        const [rows] = await sequelize2.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
        `);
        const present = new Set(rows.map(r => r.table_name));
        const missing = expected.filter(t => !present.has(t));
        res.json({ ok: missing.length === 0, missing, present: expected.filter(t => present.has(t)) });
      } catch (e) {
        console.error('DB table check error:', e);
        res.status(500).json({ error: e.message });
      }
    });
  }
} catch {}

/* ----------------------------------- 404 ----------------------------------- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send('Not found');
});

/* ------------------------------- Error handler ----------------------------- */
app.use((err, _req, res, _next) => {
  // Postgres codes we want to surface as friendly messages:
  // 42P01: undefined_table, 42703: undefined_column, 23505: unique_violation, 23503: foreign_key_violation
  const pgCode = err?.original?.code || err?.parent?.code;

  let status = err.status || 500;
  let message;

  if (pgCode === '42P01') {
    message = 'Required table is missing. Run DB migrations on this environment (e.g. `npx sequelize-cli db:migrate`).';
  } else if (pgCode === '42703') {
    message = 'A required column is missing. Ensure migrations are up to date.';
  } else if (pgCode === '23505') {
    message = 'Unique constraint failed — a record with the same unique field already exists.';
    status = 409;
  } else if (pgCode === '23503') {
    message = 'Foreign key constraint failed — related record missing or in use.';
    status = 422;
  } else {
    message = err.expose ? err.message : (status === 500 ? 'Internal server error' : err.message);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('❌ Error:', err);
  }

  res.status(status).json({ error: message, code: pgCode || undefined, requestId: res.getHeader('X-Request-Id') });
});

module.exports = app;
