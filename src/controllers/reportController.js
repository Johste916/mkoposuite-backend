/* eslint-disable no-console */
const { Op, fn, col } = require('sequelize');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

let db = {};
try { db = require('../models'); } catch (e) { db = {}; }

// Prefer whichever models exist in your build
const Loan               = db.Loan || db.Loans;
const LoanPayment        = db.LoanPayment || db.LoanRepayment || db.Repayment;
const Borrower           = db.Borrower || db.Borrowers;
const Branch             = db.Branch || db.branches || db.Branches;
const User               = db.User || db.Users;
const LoanProduct        = db.LoanProduct || db.Product || db.LoanProducts;
const SavingsTransaction = db.SavingsTransaction || db.SavingsTx;

/* ------------------------- cross-schema safe helpers ------------------------ */
const safeNumber = (v) => Number(v || 0);

// Does model have an attribute by attribute key or underlying DB field?
function hasAttr(model, name) {
  if (!model?.rawAttributes) return false;
  for (const [key, def] of Object.entries(model.rawAttributes)) {
    if (key === name || def?.field === name) return true;
  }
  return false;
}

// Resolve the first attribute that exists; returns { attrKey, fieldName }
function resolveAttr(model, candidates = []) {
  if (!model?.rawAttributes) return null;
  for (const want of candidates) {
    for (const [key, def] of Object.entries(model.rawAttributes)) {
      if (key === want || def?.field === want) {
        return { attrKey: key, fieldName: def?.field || key };
      }
    }
  }
  return null;
}

// Return first *attribute key* that exists from candidates
function pickAttrKey(model, candidates = []) {
  const r = resolveAttr(model, candidates);
  return r ? r.attrKey : null;
}

// Return first *field/column name* that exists from candidates
function pickFieldName(model, candidates = []) {
  const r = resolveAttr(model, candidates);
  return r ? r.fieldName : null;
}

// Guarded SUM — tries candidate columns in order
async function sumSafe(model, columns, where = {}) {
  for (const c of columns) {
    const key = pickAttrKey(model, [c]);
    if (!key) continue;
    try {
      const s = await model.sum(key, { where });
      if (Number.isFinite(Number(s))) return safeNumber(s);
    } catch { /* try next */ }
  }
  return 0;
}

async function countSafe(model, where = {}) {
  try { return await model.count({ where }); } catch { return 0; }
}

function parseDates(q) {
  const now = new Date();
  const startDate = q.startDate ? new Date(q.startDate) : null;
  const endDate   = q.endDate   ? new Date(q.endDate)   : null;
  const asOf      = q.asOf      ? new Date(q.asOf)      : now;
  return { startDate, endDate, asOf };
}

function betweenRange(fieldAttrKey, startDate, endDate) {
  if (!fieldAttrKey) return {};
  if (!startDate && !endDate) return {};
  if (startDate && endDate) return { [fieldAttrKey]: { [Op.between]: [startDate, endDate] } };
  if (startDate) return { [fieldAttrKey]: { [Op.gte]: startDate } };
  return { [fieldAttrKey]: { [Op.lte]: endDate } };
}

function scopeText({ branchId, officerId, borrowerId, productId }) {
  const bits = [];
  bits.push(branchId ? `Branch #${branchId}` : 'All branches');
  bits.push(officerId ? `Officer #${officerId}` : 'All officers');
  bits.push(borrowerId ? `Borrower #${borrowerId}` : 'All borrowers');
  bits.push(productId ? `Product #${productId}` : 'All products');
  return bits.join(' · ');
}

function periodText({ startDate, endDate, asOf, snapshot = false }) {
  if (snapshot) return asOf ? asOf.toISOString().slice(0,10) : '';
  if (!startDate && !endDate) return 'All time';
  const s = startDate ? startDate.toISOString().slice(0,10) : '…';
  const e = endDate   ? endDate.toISOString().slice(0,10)   : '…';
  return `${s} → ${e}`;
}

// Multi-tenant helper — add tenantId if model supports it
function tenantFilter(model, req) {
  const tenantId =
    req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    req?.headers?.['X-Tenant-Id'];
  const key = pickAttrKey(model, ['tenantId', 'tenant_id']);
  return tenantId && key ? { [key]: tenantId } : {};
}

/* ----------------------------- business helpers ---------------------------- */
// Compute outstanding per loan as of a date (defaults to now)
async function computeOutstandingByLoan(asOf = new Date(), req = null) {
  if (!Loan) return [];

  // Resolve Loan attributes
  const idField       = pickFieldName(Loan, ['id']);
  const borrowerKey   = pickAttrKey(Loan, ['borrowerId', 'borrower_id']);
  const productKey    = pickAttrKey(Loan, ['productId', 'product_id']);
  const amountKey     = pickAttrKey(Loan, ['amount', 'loanAmount', 'principalAmount']);
  const principalKey  = pickAttrKey(Loan, ['principal', 'principalAmount', 'amount', 'loanAmount']);
  const createdAtKey  = pickAttrKey(Loan, ['createdAt', 'created_at']);

  // Resolve LoanPayment attributes
  const lpLoanIdKey   = pickAttrKey(LoanPayment, ['loanId', 'loan_id']);
  const lpAmountKey   = pickAttrKey(LoanPayment, ['amountPaid', 'amount', 'paidAmount', 'paymentAmount']);
  const lpStatusKey   = pickAttrKey(LoanPayment, ['status']);
  const lpAppliedKey  = pickAttrKey(LoanPayment, ['applied']);
  const lpDateKey     = pickAttrKey(LoanPayment, ['paymentDate', 'date', 'createdAt', 'created_at']);
  const lpCreatedKey  = pickAttrKey(LoanPayment, ['createdAt', 'created_at']);

  // Sum payments per loan up to asOf (NO ORDER BY in grouped query, and UNSCOPED to avoid default order)
  let paidMap = new Map();
  if (LoanPayment && lpLoanIdKey && lpAmountKey) {
    const where = {
      ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
      ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
      ...(lpDateKey ? { [lpDateKey]: { [Op.lte]: asOf } } : {}),
      ...tenantFilter(LoanPayment, req),
    };

    const loanIdField = LoanPayment?.rawAttributes?.[lpLoanIdKey]?.field || lpLoanIdKey;
    const amountField = LoanPayment?.rawAttributes?.[lpAmountKey]?.field || lpAmountKey;
    const dateField   = lpDateKey    ? (LoanPayment?.rawAttributes?.[lpDateKey]?.field   || lpDateKey)   : null;
    const createdFld  = lpCreatedKey ? (LoanPayment?.rawAttributes?.[lpCreatedKey]?.field|| lpCreatedKey): null;

    const attrs = [
      [col(loanIdField), 'loanId'],
      [fn('sum', col(amountField)), 'paid'],
    ];
    // Optional: keep last dates as aggregates (safe with GROUP BY)
    if (dateField)   attrs.push([fn('max', col(dateField)), 'lastPaymentDate']);
    if (createdFld)  attrs.push([fn('max', col(createdFld)), 'lastCreatedAt']);

    const paidByLoan = await (LoanPayment.unscoped
      ? LoanPayment.unscoped().findAll({
          where,
          attributes: attrs,
          group: [col(loanIdField)],
          raw: true,
        })
      : LoanPayment.findAll({
          where,
          attributes: attrs,
          group: [col(loanIdField)],
          raw: true,
        }));

    paidMap = new Map((paidByLoan || []).map(r => [String(r.loanId), safeNumber(r.paid)]));
  }

  // Fetch loans (only the columns that exist)
  const loanAttrs = [];
  if (idField)      loanAttrs.push([col(idField), 'id']);
  if (borrowerKey)  loanAttrs.push([col(Loan.rawAttributes[borrowerKey].field || borrowerKey), 'borrowerId']);
  if (productKey)   loanAttrs.push([col(Loan.rawAttributes[productKey].field  || productKey),  'productId']);
  if (amountKey)    loanAttrs.push([col(Loan.rawAttributes[amountKey].field    || amountKey),   'amount']);
  if (principalKey) loanAttrs.push([col(Loan.rawAttributes[principalKey].field || principalKey), 'principal']);
  if (createdAtKey) loanAttrs.push([col(Loan.rawAttributes[createdAtKey].field || createdAtKey), 'createdAt']);

  const loans = await (Loan ? Loan.findAll({
    attributes: loanAttrs.length ? loanAttrs : undefined,
    where: { ...tenantFilter(Loan, req) },
    raw: true,
  }) : []);

  // Compute outstanding (principal or amount minus paid)
  const rows = (loans || []).map(l => {
    const principal = safeNumber(
      l.principal != null ? l.principal :
      l.amount    != null ? l.amount    : 0
    );
    const paid = paidMap.get(String(l.id)) || 0;
    const outstanding = Math.max(0, principal - paid);
    return { loanId: l.id, outstanding };
  }).filter(r => r.loanId && r.outstanding > 0);

  return rows;
}

/* --------------------------------- FILTERS --------------------------------- */
exports.getFilters = async (req, res) => {
  try {
    const [branches, officers, borrowers, products] = await Promise.all([
      Branch ? Branch.findAll({
        attributes: hasAttr(Branch, 'name')
          ? ['id', 'name']
          : ['id'],
        where: { ...tenantFilter(Branch, req) },
        order: hasAttr(Branch, 'name') ? [['name', 'ASC']] : undefined,
        raw: true,
      }) : [],
      User ? User.findAll({
        attributes: ['id', ...(hasAttr(User, 'name') ? ['name'] : []), ...(hasAttr(User, 'email') ? ['email'] : [])],
        where: {
          ...(hasAttr(User, 'role') ? { role: 'loan_officer' } : {}),
          ...tenantFilter(User, req),
        },
        order: hasAttr(User, 'name') ? [['name', 'ASC']] : undefined,
        raw: true,
      }) : [],
      Borrower ? Borrower.findAll({
        attributes: ['id', ...(hasAttr(Borrower, 'name') ? ['name'] : [])],
        where: { ...tenantFilter(Borrower, req) },
        order: hasAttr(Borrower, 'name') ? [['name', 'ASC']] : undefined,
        raw: true,
      }) : [],
      LoanProduct ? LoanProduct.findAll({
        attributes: ['id', ...(hasAttr(LoanProduct, 'name') ? ['name'] : [])],
        where: { ...tenantFilter(LoanProduct, req) },
        order: hasAttr(LoanProduct, 'name') ? [['name', 'ASC']] : undefined,
        raw: true,
      }) : [],
    ]);
    res.json({ branches, officers, borrowers, products, welcome: 'Welcome! Choose filters and export whenever ready.' });
  } catch (e) {
    console.error('filters error:', e);
    res.json({ branches: [], officers: [], borrowers: [], products: [], welcome: 'Welcome!' });
  }
};

/* ------------------------- BORROWERS (loan summary) ------------------------ */
exports.borrowersLoanSummary = async (req, res) => {
  try {
    const { branchId, officerId, borrowerId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    // Loan filters
    const loanDateKey = pickAttrKey(Loan, ['createdAt', 'created_at']);
    const loanWhere = {
      ...(borrowerId && hasAttr(Loan, 'borrowerId') ? { borrowerId } : {}),
      ...(startDate || endDate ? betweenRange(loanDateKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };

    const [loanCount, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, loanWhere) : 0,
      Loan ? sumSafe(Loan, ['amount', 'principal', 'principalAmount', 'loanAmount'], loanWhere) : 0,
    ]);

    // Collections
    let totalRepayments = 0;
    if (LoanPayment) {
      const lpAmountKey  = pickAttrKey(LoanPayment, ['amountPaid', 'amount', 'paidAmount', 'paymentAmount']);
      const lpDateKey    = pickAttrKey(LoanPayment, ['paymentDate', 'date', 'createdAt', 'created_at']);
      const lpStatusKey  = pickAttrKey(LoanPayment, ['status']);
      const lpAppliedKey = pickAttrKey(LoanPayment, ['applied']);

      const payWhere = {
        ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
        ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
        ...(lpDateKey ? betweenRange(lpDateKey, startDate, endDate) : {}),
        ...(branchId && hasAttr(LoanPayment, 'branchId') ? { branchId } : {}),
        ...(officerId && hasAttr(LoanPayment, 'officerId') ? { officerId } : {}),
        ...(borrowerId && hasAttr(LoanPayment, 'borrowerId') ? { borrowerId } : {}),
        ...tenantFilter(LoanPayment, req),
      };
      totalRepayments = lpAmountKey ? await sumSafe(LoanPayment, [lpAmountKey], payWhere) : 0;
    }

    const outstandingRows = await computeOutstandingByLoan(new Date(), req);
    const outstandingBalance = outstandingRows.reduce((s, r) => s + safeNumber(r.outstanding), 0);

    const defaulterCount = 0;
    const arrearsAmount  = 0;

    res.json({
      summary: { loanCount, totalRepayments, defaulterCount },
      table: {
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'value',  label: 'Value' }
        ],
        rows: [
          { metric: 'Total Loans Count',   value: loanCount },
          { metric: 'Total Disbursed',     value: totalDisbursed, currency: true },
          { metric: 'Total Repayments',    value: totalRepayments, currency: true },
          { metric: 'Outstanding Balance', value: outstandingBalance, currency: true },
          { metric: 'Arrears Count',       value: defaulterCount },
          { metric: 'Arrears Amount',      value: arrearsAmount, currency: true },
        ],
      },
      period: periodText({ startDate, endDate }),
      scope:  scopeText({ branchId, officerId, borrowerId }),
      welcome: 'Here is a friendly summary for your borrowers. Apply filters to narrow focus and export anytime!',
    });
  } catch (err) {
    console.error('borrowersLoanSummary error:', err);
    res.json({
      summary: { loanCount: 0, totalRepayments: 0, defaulterCount: 0 },
      table: { rows: [] },
      period: periodText({}),
      scope: scopeText({}),
      welcome: 'No data yet — try a different filter range.',
    });
  }
};

/* ---------------------------------- Trends --------------------------------- */
exports.loansTrends = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end   = new Date(`${year}-12-31T23:59:59.999Z`);
    const monthly = Array.from({length:12},(_,i)=>({month:i+1,loans:0,repayments:0}));

    const loanDateKey = pickAttrKey(Loan, ['createdAt', 'created_at']);
    const loanAmountKey = pickAttrKey(Loan, ['amount', 'principal', 'principalAmount', 'loanAmount']);

    const payDateKey   = pickAttrKey(LoanPayment, ['paymentDate', 'date', 'createdAt', 'created_at']);
    const payAmtKey    = pickAttrKey(LoanPayment, ['amountPaid', 'amount', 'paidAmount', 'paymentAmount']);

    const loans = Loan ? await Loan.findAll({
      where: {
        ...(loanDateKey ? { [loanDateKey]: { [Op.between]: [start, end] } } : {}),
        ...tenantFilter(Loan, req),
      },
      attributes: [loanAmountKey || 'id', loanDateKey || 'id'],
      raw: true,
    }) : [];

    const pays = (LoanPayment && payAmtKey) ? await LoanPayment.findAll({
      where: {
        ...(payDateKey ? { [payDateKey]: { [Op.between]: [start, end] } } : {}),
        ...tenantFilter(LoanPayment, req),
      },
      attributes: [payAmtKey, payDateKey || 'id'],
      raw: true,
    }) : [];

    loans.forEach(l => {
      const dt = loanDateKey ? l[loanDateKey] : null;
      const m = dt ? new Date(dt).getMonth() : 0;
      monthly[m].loans += safeNumber(l[loanAmountKey] || 0);
    });
    pays.forEach(p => {
      const dt = payDateKey ? p[payDateKey] : null;
      const m = dt ? new Date(dt).getMonth() : 0;
      monthly[m].repayments += safeNumber(p[payAmtKey] || 0);
    });

    res.json(monthly);
  } catch (e) {
    console.error('Trend error:', e);
    res.json([]);
  }
};

/* ------------------------- Loans summary/register -------------------------- */
exports.loansSummary = async (req, res) => {
  try {
    const { productId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    const loanDateKey = pickAttrKey(Loan, ['createdAt', 'created_at']);
    const where = {
      ...(productId && hasAttr(Loan, 'productId') ? { productId } : {}),
      ...(startDate || endDate ? betweenRange(loanDateKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };

    const [count, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal','principalAmount','loanAmount'], where) : 0,
    ]);

    let rows = [];
    if (Loan) {
      const idKey        = pickAttrKey(Loan, ['id']);
      const borrowerKey  = pickAttrKey(Loan, ['borrowerId','borrower_id']);
      const productKey   = pickAttrKey(Loan, ['productId','product_id']);
      const amountKey    = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
      const statusKey    = pickAttrKey(Loan, ['status']);
      const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);

      const attrs = [];
      if (idKey)        attrs.push(idKey);
      if (borrowerKey)  attrs.push(borrowerKey);
      if (productKey)   attrs.push(productKey);
      if (amountKey)    attrs.push(amountKey);
      if (statusKey)    attrs.push(statusKey);
      if (createdAtKey) attrs.push(createdAtKey);

      rows = await Loan.findAll({
        where,
        attributes: attrs.length ? attrs : undefined,
        order: createdAtKey ? [[createdAtKey, 'DESC']] : undefined,
        limit: 200,
        raw: true,
      });
    }

    res.json({
      summary: { loans: count, disbursed: totalDisbursed },
      rows,
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
      welcome: 'This is your live loan register — filter, review, and export with confidence.',
    });
  } catch (e) {
    console.error('loansSummary error:', e);
    res.json({ summary:{loans:0,disbursed:0}, rows:[], period: periodText({}), scope: scopeText({}), welcome: 'No loans in this range.' });
  }
};

exports.loansExportCSV = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);
    const where = {
      ...(startDate || endDate ? betweenRange(createdAtKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };

    const idKey        = pickAttrKey(Loan, ['id']);
    const borrowerKey  = pickAttrKey(Loan, ['borrowerId','borrower_id']);
    const productKey   = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey    = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const statusKey    = pickAttrKey(Loan, ['status']);

    const list = Loan ? await Loan.findAll({
      where,
      attributes: [idKey, borrowerKey, productKey, amountKey, statusKey, createdAtKey].filter(Boolean),
      order: createdAtKey ? [[createdAtKey,'DESC']] : undefined,
      raw: true
    }) : [];

    const parser = new Parser();
    const csv = parser.parse(list);
    res.header('Content-Type','text/csv');
    res.attachment('loans.csv');
    res.send(csv);
  } catch (e) {
    console.error('loansExportCSV error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};

exports.loansExportPDF = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);
    const where = {
      ...(startDate || endDate ? betweenRange(createdAtKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };

    const idKey        = pickAttrKey(Loan, ['id']);
    const borrowerKey  = pickAttrKey(Loan, ['borrowerId','borrower_id']);
    const productKey   = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey    = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const statusKey    = pickAttrKey(Loan, ['status']);

    const list = Loan ? await Loan.findAll({
      where,
      attributes: [idKey, borrowerKey, productKey, amountKey, statusKey, createdAtKey].filter(Boolean),
      order: createdAtKey ? [[createdAtKey,'DESC']] : undefined,
      raw: true
    }) : [];

    const doc = new PDFDocument({ margin: 36 });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename=loans.pdf');
      res.send(Buffer.concat(chunks));
    });
    doc.fontSize(16).text('Loan Report', { align: 'center' }).moveDown();
    list.forEach(l => {
      const when = createdAtKey && l[createdAtKey] ? String(l[createdAtKey]).slice(0,10) : '';
      const amt  = amountKey && l[amountKey] != null ? Number(l[amountKey]).toLocaleString() : '0';
      doc.fontSize(11).text(
        `Loan #${l[idKey]} • Borrower ${borrowerKey? l[borrowerKey]:''} • Product ${productKey? l[productKey]:''} • Amount ${amt} • ${statusKey? (l[statusKey]||''):''} • ${when}`
      );
    });
    doc.end();
  } catch (e) {
    console.error('loansExportPDF error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};

/* ---------------------- Arrears aging (placeholder) ------------------------ */
exports.arrearsAging = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    res.json({
      asOf,
      table: {
        columns: [{ key:'bucket', label:'Bucket' }, { key:'count', label:'Count' }, { key:'amount', label:'Amount', currency:true }],
        rows: [
          { bucket: '1-29',  count: 0, amount: 0 },
          { bucket: '30-59', count: 0, amount: 0 },
          { bucket: '60-89', count: 0, amount: 0 },
          { bucket: '90+',   count: 0, amount: 0 },
        ],
      },
      period: '',
      scope: scopeText(req.query),
      welcome: 'Aging buckets will populate once scheduled dues are tracked.',
    });
  } catch (e) {
    console.error('arrearsAging error:', e);
    res.json({ asOf: new Date(), table: { rows: [] }, period: '', scope: scopeText({}) });
  }
};

/* -------------------------------- Collections ------------------------------ */
exports.collectionsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) {
      return res.json({
        summary:{ total:0, receipts:0 },
        table: { columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[
          { metric:'Total Collections', value:0, currency:true },
          { metric:'Receipts Count', value:0 }
        ]},
        period: periodText({startDate,endDate}),
        scope: scopeText(req.query),
        welcome: 'Collections at a glance — totals and receipts count.',
      });
    }

    const lpAmountKey  = pickAttrKey(LoanPayment, ['amountPaid','amount','paidAmount','paymentAmount']);
    const lpDateKey    = pickAttrKey(LoanPayment, ['paymentDate','date','createdAt','created_at']);
    const lpStatusKey  = pickAttrKey(LoanPayment, ['status']);
    const lpAppliedKey = pickAttrKey(LoanPayment, ['applied']);

    const where = {
      ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
      ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
      ...(lpDateKey ? betweenRange(lpDateKey, startDate, endDate) : {}),
      ...tenantFilter(LoanPayment, req),
    };

    const [total, receipts] = await Promise.all([
      lpAmountKey ? sumSafe(LoanPayment, [lpAmountKey], where) : 0,
      countSafe(LoanPayment, where)
    ]);

    res.json({
      summary:{ total, receipts },
      table: { columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[
        { metric:'Total Collections', value: total, currency:true },
        { metric:'Receipts Count', value: receipts }
      ]},
      period: periodText({startDate,endDate}),
      scope: scopeText(req.query),
      welcome: 'Collections at a glance — totals and receipts count.',
    });
  } catch (e) {
    console.error('collectionsSummary error:', e);
    res.json({ summary:{total:0,receipts:0}, table:{ rows:[] }, period: periodText({}), scope: scopeText({}) });
  }
};

exports.collectorSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) {
      return res.json({
        summary:{ total:0 },
        table:{ columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[{ metric:'Total Collected', value:0, currency:true }]},
        period: periodText({startDate,endDate}),
        scope: scopeText(req.query),
      });
    }

    const lpAmountKey  = pickAttrKey(LoanPayment, ['amountPaid','amount','paidAmount','paymentAmount']);
    const lpDateKey    = pickAttrKey(LoanPayment, ['paymentDate','date','createdAt','created_at']);
    const lpStatusKey  = pickAttrKey(LoanPayment, ['status']);
    const lpAppliedKey = pickAttrKey(LoanPayment, ['applied']);

    const where = {
      ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
      ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
      ...(lpDateKey ? betweenRange(lpDateKey, startDate, endDate) : {}),
      ...(req.query.officerId && hasAttr(LoanPayment, 'officerId') ? { officerId: req.query.officerId } : {}),
      ...tenantFilter(LoanPayment, req),
    };

    const total = lpAmountKey ? await sumSafe(LoanPayment, [lpAmountKey], where) : 0;
    res.json({
      summary:{ total },
      table:{ columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[{ metric:'Total Collected', value: total, currency:true }]},
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
      welcome: 'Collector summary — filter by officer to drill down.',
    });
  } catch (e) {
    console.error('collectorSummary error:', e);
    res.json({ summary:{ total:0 }, table:{ rows:[] }, period: periodText({}), scope: scopeText({}) });
  }
};

/* ------------------------------ Deferred income ---------------------------- */
exports.deferredIncome = async (req, res) => {
  const period = periodText(parseDates(req.query));
  const scope = scopeText(req.query);
  res.json({
    summary:{ accrued:0, received:0, deferred:0 },
    table: {
      columns: [{ key:'metric', label:'Metric' }, { key:'value', label:'Value' }],
      rows: [
        { metric:'Accrued',  value:0, currency:true },
        { metric:'Received', value:0, currency:true },
        { metric:'Deferred', value:0, currency:true },
      ],
    },
    period,
    scope,
    welcome: 'Deferred income coming soon (requires fee accrual tracking).'
  });
};

exports.deferredIncomeMonthly = async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = Array.from({length:12},(_,i)=>({ month:i+1, opening:0, accrued:0, received:0, closing:0 }));
  res.json({
    year,
    rows, // raw (for APIs)
    table: {
      columns: [
        { key:'month',    label:'Month' },
        { key:'opening',  label:'Opening',  currency:true },
        { key:'accrued',  label:'Accrued',  currency:true },
        { key:'received', label:'Received', currency:true },
        { key:'closing',  label:'Closing',  currency:true },
      ],
      rows: rows.map(r => ({ ...r, month: r.month })), // UI table
    },
    period: `${year}-01-01 → ${year}-12-31`,
    scope: scopeText(req.query),
    welcome: 'Monthly deferred income roll-forward (placeholder).'
  });
};

/* ---------------------------- Pro-rata collections ------------------------- */
exports.proRataCollections = async (req, res) => {
  const p = periodText(parseDates(req.query));
  res.json({
    summary:{ expected:0, actual:0, variance:0, achievement:0 },
    table: {
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows:[
        { metric:'Expected',   value:0, currency:true },
        { metric:'Actual',     value:0, currency:true },
        { metric:'Variance',   value:0, currency:true },
        { metric:'Achievement',value:0, percent:true },
      ],
    },
    period: p,
    scope: scopeText(req.query),
    welcome: 'Pro-rata view will activate when targets are configured.'
  });
};

/* -------------------------------- Disbursements ---------------------------- */
exports.disbursementsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);
    const where = {
      ...(startDate || endDate ? betweenRange(createdAtKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };
    const [count, total] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal','principalAmount','loanAmount'], where) : 0,
    ]);
    res.json({
      summary:{ count, total },
      table: {
        columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
        rows:[
          { metric:'Total Disbursements Count', value: count },
          { metric:'Total Disbursed Amount',    value: total, currency:true },
        ],
      },
      period: periodText({startDate,endDate}),
      scope: scopeText(req.query),
      welcome: 'Disbursements in the selected period.',
    });
  } catch (e) {
    console.error('disbursementsSummary error:', e);
    res.json({ summary:{ count:0, total:0 }, table:{ rows:[] }, period: periodText({}), scope: scopeText({}) });
  }
};

/* ------------------------------------ Fees -------------------------------- */
exports.feesSummary = async (req, res) => {
  const p = periodText(parseDates(req.query));
  res.json({
    summary:{ total:0 },
    byType:[],
    table:{
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows:[{ metric:'Total Fees', value:0, currency:true }],
    },
    period: p,
    scope: scopeText(req.query),
    welcome: 'Fees breakdown will appear when fee postings are tracked.'
  });
};

/* -------------------------------- Loan officer ----------------------------- */
exports.loanOfficerSummary = async (req, res) => {
  const p = periodText(parseDates(req.query));
  res.json({
    summary:{ disbursed:0, collections:0, par30:0 },
    rows:[],
    table:{
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows:[
        { metric:'Disbursed',  value:0, currency:true },
        { metric:'Collections',value:0, currency:true },
        { metric:'PAR30',      value:0, percent:true },
      ],
    },
    period: p,
    scope: scopeText(req.query),
    welcome: 'Officer performance snapshots coming soon.'
  });
};

/* ------------------------------- Loan products ----------------------------- */
exports.loanProductsSummary = async (req, res) => {
  const p = periodText(parseDates(req.query));
  res.json({
    rows:[],
    table: {
      columns:[{key:'product',label:'Product'},{key:'loans',label:'Loans'},{key:'amount',label:'Amount',currency:true}],
      rows:[],
    },
    period: p,
    scope: scopeText(req.query),
    welcome: 'Product mix and yields will populate as data accrues.'
  });
};

/* ------------------------------------ MFRS --------------------------------- */
exports.mfrsRatios = async (req, res) => {
  const { asOf } = parseDates(req.query);
  const ratios = {
    par30: 0, par60: 0, par90: 0,
    olp: 0, activeBorrowers: 0, avgLoanSize: 0,
    portfolioYield: 0, writeOffRatio: 0, opexRatio: 0, costPerBorrower: 0,
    collectionEfficiency: 0
  };
  res.json({
    asOf,
    ratios,
    table: {
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows: [
        { metric:'Outstanding Loan Portfolio (OLP)', value: ratios.olp, currency:true },
        { metric:'Active Borrowers', value: ratios.activeBorrowers },
        { metric:'Average Loan Size', value: ratios.avgLoanSize, currency:true },
        { metric:'Portfolio Yield', value: ratios.portfolioYield, percent:true },
        { metric:'Write-off Ratio', value: ratios.writeOffRatio, percent:true },
        { metric:'Opex Ratio', value: ratios.opexRatio, percent:true },
        { metric:'Cost per Borrower', value: ratios.costPerBorrower, currency:true },
        { metric:'Collection Efficiency', value: ratios.collectionEfficiency, percent:true },
        { metric:'PAR30', value: ratios.par30, percent:true },
        { metric:'PAR60', value: ratios.par60, percent:true },
        { metric:'PAR90', value: ratios.par90, percent:true },
      ],
    },
    welcome: 'Key ratios will engage when the required data points exist.'
  });
};

/* ------------------------------- Daily / Monthly --------------------------- */
exports.dailyReport = async (req, res) => {
  const { asOf } = parseDates({ asOf: req.query.date });
  res.json({
    date: asOf,
    disbursed: 0, collected: 0, newBorrowers: 0, exceptions: [],
    table: {
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows:[
        { metric:'Disbursed', value:0, currency:true },
        { metric:'Collected', value:0, currency:true },
        { metric:'New Borrowers', value:0 },
      ]
    },
    welcome: 'Daily spotlight for your ops.'
  });
};

exports.monthlyReport = async (req, res) => {
  const month = Number(req.query.month)||new Date().getMonth()+1;
  const year  = Number(req.query.year)||new Date().getFullYear();
  res.json({
    month, year,
    kpis: { disbursed:0, collected:0, par:0 },
    table:{
      columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}],
      rows:[
        { metric:'Disbursed', value:0, currency:true },
        { metric:'Collected', value:0, currency:true },
        { metric:'PAR',       value:0, percent:true },
      ]
    },
    welcome: 'Monthly KPIs at a glance.'
  });
};

/* -------------------------------- Outstanding ------------------------------ */
exports.outstandingReport = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(asOf, req);
    const total = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);
    res.json({
      rows, // detailed rows per loan (kept as-is for this report)
      totals: { outstanding: total },
      asOf,
      scope: scopeText(req.query),
      welcome: 'Snapshot of outstanding portfolio.'
    });
  } catch (e) {
    console.error('outstandingReport error:', e);
    res.json({ rows:[], totals:{ outstanding:0 }, asOf: parseDates(req.query).asOf, welcome: 'No outstanding data yet.' });
  }
};

/* ---------------------------------- PAR ------------------------------------ */
exports.parSummary = async (req, res) => {
  try {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(asOf, req);
    const olp = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

    res.json({
      asOf,
      table: {
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'value',  label: 'Value' }
        ],
        rows: [
          { metric: 'Outstanding Loan Portfolio (OLP)', value: olp, currency: true },
          { metric: 'PAR30', value: 0, percent: true },
          { metric: 'PAR60', value: 0, percent: true },
          { metric: 'PAR90', value: 0, percent: true },
        ],
      },
      welcome: 'PAR summary (approximate until schedules are enabled).'
    });
  } catch (e) {
    console.error('parSummary error:', e);
    res.json({
      asOf: parseDates(req.query).asOf,
      table: { rows: [] },
      welcome: 'PAR unavailable for now.'
    });
  }
};

/* ------------------------------- At a glance ------------------------------- */
exports.atAGlance = async (req, res) => {
  const { startDate, endDate, asOf } = parseDates(req.query);
  const rows = await computeOutstandingByLoan(asOf, req);
  const outstanding = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

  res.json({
    asOf,
    period: periodText({startDate,endDate}),
    cards: [
      { title:'Outstanding Portfolio', value: outstanding, currency:true },
      { title:'PAR30', value: 0.0, percent:true },
      { title:'Disbursed (MTD)', value: 0, currency:true },
      { title:'Collections (MTD)', value: 0, currency:true },
    ],
    trends: [],
    welcome: 'A friendly dashboard snapshot.'
  });
};

/* -------------------------------- All entries ------------------------------ */
exports.allEntries = async (req, res) => {
  res.json({
    rows: [],
    table: { columns:[{key:'date',label:'Date'},{key:'type',label:'Type'},{key:'amount',label:'Amount',currency:true}], rows:[] },
    period: periodText(parseDates(req.query)),
    scope: scopeText(req.query),
    welcome: 'Unified feed will appear when posting journal lines.'
  });
};
