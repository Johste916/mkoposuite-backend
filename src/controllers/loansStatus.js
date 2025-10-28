/* eslint-disable no-console */
const { Op, fn, col, cast, where: sqWhere } = require('sequelize');

let db = {};
try { db = require('../models'); } catch (e) { db = {}; }

const Loan        = db.Loan || db.Loans;
const LoanPayment = db.LoanPayment || db.LoanRepayment || db.Repayment;
const Borrower    = db.Borrower || db.Borrowers;
const LoanProduct = db.LoanProduct || db.Product || db.LoanProducts;
const User        = db.User || db.Users;

/* ------------------------- helpers ------------------------ */
const safeNumber = (v) => Number(v || 0);
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
function pickAttrKey(model, candidates = []) {
  const r = resolveAttr(model, candidates);
  return r ? r.attrKey : null;
}
function betweenRange(fieldAttrKey, startDate, endDate) {
  if (!fieldAttrKey) return {};
  if (!startDate && !endDate) return {};
  if (startDate && endDate) return { [fieldAttrKey]: { [Op.between]: [startDate, endDate] } };
  if (startDate) return { [fieldAttrKey]: { [Op.gte]: startDate } };
  return { [fieldAttrKey]: { [Op.lte]: endDate } };
}
function tenantFilter(model, req) {
  const tenantId = req?.tenant?.id ||
    req?.headers?.['x-tenant-id'] ||
    req?.headers?.['X-Tenant-Id'];
  const key = pickAttrKey(model, ['tenantId', 'tenant_id']);
  return tenantId && key ? { [key]: tenantId } : {};
}

async function paidMapUpTo(asOf, req) {
  const lpLoanIdKey = pickAttrKey(LoanPayment, ['loanId','loan_id']);
  const lpAmountKey = pickAttrKey(LoanPayment, ['amountPaid','amount','paidAmount','paymentAmount']);
  const lpStatusKey = pickAttrKey(LoanPayment, ['status']);
  const lpAppliedKey = pickAttrKey(LoanPayment, ['applied']);
  const lpDateKey = pickAttrKey(LoanPayment, ['paymentDate','date','createdAt','created_at']);
  if (!LoanPayment || !lpLoanIdKey || !lpAmountKey) return new Map();

  const where = {
    ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
    ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
    ...(lpDateKey ? { [lpDateKey]: { [Op.lte]: asOf } } : {}),
    ...tenantFilter(LoanPayment, req),
  };
  const loanIdField = LoanPayment?.rawAttributes?.[lpLoanIdKey]?.field || lpLoanIdKey;
  const amountField = LoanPayment?.rawAttributes?.[lpAmountKey]?.field || lpAmountKey;

  const rows = await LoanPayment.findAll({
    where,
    attributes: [[col(loanIdField),'loanId'], [fn('sum', col(amountField)), 'paid']],
    group: [col(loanIdField)],
    raw: true,
  });
  return new Map(rows.map(r => [String(r.loanId), safeNumber(r.paid)]));
}

function pickMaturityKey() {
  return pickAttrKey(Loan, [
    'maturityDate','maturity_date',
    'endDate','end_date','expectedEndDate','expected_end_date',
    'dueDate','due_date',
  ]);
}
function pickTermKey() {
  return pickAttrKey(Loan, [
    'termMonths','durationMonths','loanTerm','tenorMonths','tenureMonths',
    'term_months','duration_months','loan_term','tenor_months','tenure_months',
  ]);
}

async function fetchBaseLoans(where, req) {
  if (!Loan) return [];
  const idKey       = pickAttrKey(Loan, ['id']);
  const borrowerKey = pickAttrKey(Loan, ['borrowerId','borrower_id']);
  const productKey  = pickAttrKey(Loan, ['productId','product_id']);
  const amountKey   = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
  const rateKey     = pickAttrKey(Loan, ['interestRate','interest_rate','interestRateYear','interestRatePerYear']);
  const currencyKey = pickAttrKey(Loan, ['currency']);
  const startKey    = pickAttrKey(Loan, ['disbursementDate','disbursement_date','startDate','start_date','createdAt','created_at']);
  const statusKey   = pickAttrKey(Loan, ['status']);
  const termKey     = pickTermKey();
  const matKey      = pickMaturityKey();

  const attrs = [idKey, borrowerKey, productKey, amountKey, rateKey, currencyKey, startKey, statusKey, termKey, matKey].filter(Boolean);
  const rows = await Loan.findAll({
    where: { ...where, ...tenantFilter(Loan, req) },
    attributes: attrs,
    order: startKey ? [[startKey, 'DESC']] : undefined,
    limit: 1000,
    raw: true,
  });

  const borrowerIds = Array.from(new Set(rows.map(r => r[borrowerKey]).filter(Boolean))).map(String);
  const productIds  = Array.from(new Set(rows.map(r => r[productKey]).filter(Boolean))).map(String);
  let borrowers = {}, products = {};

  if (Borrower && borrowerIds.length) {
    const bNameKey = pickAttrKey(Borrower, ['name']);
    const bList = await Borrower.findAll({ where: { id: { [Op.in]: borrowerIds }, ...tenantFilter(Borrower, req) }, attributes: ['id', ...(bNameKey?[bNameKey]:[])], raw: true });
    borrowers = Object.fromEntries(bList.map(b => [String(b.id), (b[bNameKey] || b.name || '')]));
  }
  if (LoanProduct && productIds.length) {
    const pNameKey = pickAttrKey(LoanProduct, ['name']);
    const pList = await LoanProduct.findAll({ where: { id: { [Op.in]: productIds }, ...tenantFilter(LoanProduct, req) }, attributes: ['id', ...(pNameKey?[pNameKey]:[])], raw: true });
    products = Object.fromEntries(pList.map(p => [String(p.id), (p[pNameKey] || p.name || '')]));
  }

  return { rows, keys: { idKey, borrowerKey, productKey, amountKey, rateKey, currencyKey, startKey, statusKey, termKey, matKey }, borrowers, products };
}

async function attachOutstanding(uiRows, asOf, req) {
  const paidMap = await paidMapUpTo(asOf, req);
  uiRows.forEach(r => {
    const paid = safeNumber(paidMap.get(String(r.id)));
    r.paidToDate = paid;
    r.totalOutstanding = Math.max(0, safeNumber(r.principalAmount) - paid);
  });
  return uiRows;
}

/* ----------------------------- status endpoint ---------------------------- */

/* ----------------------------- status endpoint ---------------------------- */

/** Month-aware add that stays on the last valid day when needed (e.g., Jan 31 + 1m → Feb 29/28). */
function addMonthsDateOnly(dateInput, months) {
  if (!dateInput) return null;
  const s = String(dateInput);
  const y = Number(s.slice(0,4));
  const m = Number(s.slice(5,7));
  const d = Number(s.slice(8,10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    // Fallback: let JS parse and still try to behave
    const dt = new Date(s);
    if (isNaN(dt)) return null;
    const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + Number(months), dt.getUTCDate()));
    if (t.getUTCMonth() !== ((dt.getUTCMonth() + Number(months)) % 12 + 12) % 12) t.setUTCDate(0);
    return t.toISOString().slice(0,10);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  const t  = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + Number(months), dt.getUTCDate()));
  if (t.getUTCMonth() !== ((m - 1 + Number(months)) % 12 + 12) % 12) t.setUTCDate(0);
  return t.toISOString().slice(0,10);
}

/** Resolve the best "start date" column a loan uses. */
function pickStartKey() {
  return pickAttrKey(Loan, [
    'disbursementDate','disbursement_date',
    'startDate','start_date',
    'createdAt','created_at'
  ]);
}

/** Resolve a reasonable "officer" foreign key on loans. */
function pickOfficerKey() {
  return pickAttrKey(Loan, [
    'officerId','loanOfficerId','userId','disbursedBy','disbursed_by'
  ]);
}

/** Resolve the user's display name column. */
function pickUserNameKey() {
  return pickAttrKey(User, ['name','fullName','full_name','displayName','display_name']);
}

/** Extended fetch to include optional extra attr keys (e.g., officer FK). */
async function fetchBaseLoans(where, req, extraAttrKeys = []) {
  if (!Loan) return [];
  const idKey       = pickAttrKey(Loan, ['id']);
  const borrowerKey = pickAttrKey(Loan, ['borrowerId','borrower_id']);
  const productKey  = pickAttrKey(Loan, ['productId','product_id']);
  const amountKey   = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
  const rateKey     = pickAttrKey(Loan, ['interestRate','interest_rate','interestRateYear','interestRatePerYear']);
  const currencyKey = pickAttrKey(Loan, ['currency']);
  const startKey    = pickStartKey();
  const statusKey   = pickAttrKey(Loan, ['status']);
  const termKey     = pickTermKey();
  const matKey      = pickMaturityKey();

  const attrs = [idKey, borrowerKey, productKey, amountKey, rateKey, currencyKey, startKey, statusKey, termKey, matKey, ...extraAttrKeys].filter(Boolean);

  const rows = await Loan.findAll({
    where: { ...where, ...tenantFilter(Loan, req) },
    attributes: attrs,
    order: startKey ? [[startKey, 'DESC']] : undefined,
    limit: 1000,
    raw: true,
  });

  const borrowerIds = Array.from(new Set(rows.map(r => r[borrowerKey]).filter(Boolean))).map(String);
  const productIds  = Array.from(new Set(rows.map(r => r[productKey]).filter(Boolean))).map(String);

  let borrowers = {}, products = {};
  if (Borrower && borrowerIds.length) {
    const bNameKey = pickAttrKey(Borrower, ['name']);
    const bList = await Borrower.findAll({
      where: { id: { [Op.in]: borrowerIds }, ...tenantFilter(Borrower, req) },
      attributes: ['id', ...(bNameKey?[bNameKey]:[])],
      raw: true
    });
    borrowers = Object.fromEntries(bList.map(b => [String(b.id), (b[bNameKey] || b.name || '')]));
  }
  if (LoanProduct && productIds.length) {
    const pNameKey = pickAttrKey(LoanProduct, ['name']);
    const pList = await LoanProduct.findAll({
      where: { id: { [Op.in]: productIds }, ...tenantFilter(LoanProduct, req) },
      attributes: ['id', ...(pNameKey?[pNameKey]:[])],
      raw: true
    });
    products = Object.fromEntries(pList.map(p => [String(p.id), (p[pNameKey] || p.name || '')]));
  }

  return {
    rows,
    keys: { idKey, borrowerKey, productKey, amountKey, rateKey, currencyKey, startKey, statusKey, termKey, matKey },
    borrowers,
    products
  };
}

async function attachOfficerNames(uiRows, baseRows, officerKey, req) {
  if (!User || !officerKey) return uiRows;
  const uNameKey = pickUserNameKey() || 'name';
  const officerIds = Array.from(new Set(baseRows.map(r => r[officerKey]).filter(Boolean))).map(String);
  if (!officerIds.length) return uiRows;

  const list = await User.findAll({
    where: { id: { [Op.in]: officerIds }, ...tenantFilter(User, req) },
    attributes: ['id', uNameKey].filter(Boolean),
    raw: true
  });
  const nameMap = Object.fromEntries(list.map(u => [String(u.id), u[uNameKey] || u.name || '']));

  uiRows.forEach((r, i) => {
    const raw = baseRows[i]?.[officerKey];
    r.officerName = raw ? (nameMap[String(raw)] || '—') : '—';
  });
  return uiRows;
}

exports.listByStatus = async (req, res) => {
  try {
    const status   = String(req.query.status || req.params.status || 'disbursed').toLowerCase();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate   = req.query.endDate   ? new Date(req.query.endDate)   : null;
    const asOf      = req.query.asOf      ? new Date(req.query.asOf)      : new Date();

    const disbDateKey = pickStartKey();
    const statusKey   = pickAttrKey(Loan, ['status']);
    const productKey  = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey   = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const officerKey  = pickOfficerKey();              // NEW: officer detection
    const matKey      = pickMaturityKey();
    const termKey     = pickTermKey();

    const where = {
      ...(productKey && req.query.productId ? { [productKey]: req.query.productId } : {}),
      ...(officerKey && req.query.officerId ? { [officerKey]: req.query.officerId } : {}),
      ...(amountKey && req.query.minAmount ? { [amountKey]: { [Op.gte]: Number(req.query.minAmount) } } : {}),
      ...(amountKey && req.query.maxAmount ? { [amountKey]: { ...(where?.[amountKey] || {}), [Op.lte]: Number(req.query.maxAmount) } } : {}),
      ...(disbDateKey ? betweenRange(disbDateKey, startDate, endDate) : {}),
    };

    const orConds = [];
    if (disbDateKey) orConds.push({ [disbDateKey]: { [Op.ne]: null } });
    if (statusKey && status === 'disbursed') {
      orConds.push(sqWhere(cast(col(Loan.rawAttributes[statusKey]?.field || statusKey), 'text'), { [Op.iLike]: 'disbursed' }));
    }
    const scoped = orConds.length ? { ...where, [Op.or]: orConds } : where;

    // Fetch loans with optional officer FK included
    const base = await fetchBaseLoans(scoped, req, officerKey ? [officerKey] : []);
    const { rows, keys, borrowers, products } = base;

    // Shape base UI rows
    let ui = rows.map(r => {
      const id              = r[keys.idKey];
      const borrowerId      = r[keys.borrowerKey];
      const productId       = r[keys.productKey];
      const principalAmount = safeNumber(r[keys.amountKey]);
      const interestRate    = r[keys.rateKey] != null ? Number(r[keys.rateKey]) : null;
      const currency        = r[keys.currencyKey] || 'TZS';
      const start           = r[keys.startKey] || null;
      const dbMaturity      = r[keys.matKey] || null;
      const termMonths      = r[keys.termKey] != null ? Number(r[keys.termKey]) : null;

      // Compute maturity if not present in DB
      const maturityDate = dbMaturity || (start && termMonths ? addMonthsDateOnly(String(start).slice(0,10), termMonths) : null);

      return {
        id,
        borrowerId,
        borrowerName: borrowers[String(borrowerId)] || '—',
        productId,
        productName: products[String(productId)] || '—',
        principalAmount,
        interestRateYear: interestRate,
        currency,
        disbursementDate: start || null,
        status: r[keys.statusKey] || null,
        termMonths,
        maturityDate,
        officerName: '—', // filled below
      };
    });

    // Totals/outstanding (kept from your prior logic)
    ui = await attachOutstanding(ui, asOf, req);

    // Officer names (NEW)
    ui = await attachOfficerNames(ui, rows, officerKey, req);

    // Free text filter
    const q = (req.query.q || '').toString().trim().toLowerCase();
    if (q) {
      ui = ui.filter(r =>
        String(r.id).toLowerCase().includes(q) ||
        r.borrowerName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.officerName.toLowerCase().includes(q)
      );
    }

    const daysLate = (r) => {
      if (!r.maturityDate) return 0;
      const ms = asOf - new Date(r.maturityDate);
      return Math.floor(ms / (24*3600*1000));
    };

    // Status post-filters (unchanged semantics)
    if (status === 'no-repayments') {
      ui = ui.filter(r => safeNumber(r.paidToDate) === 0);
    }
    if (status === 'principal-outstanding') {
      ui = ui.filter(r => safeNumber(r.totalOutstanding) > 0);
    }
    if (status === 'past-maturity' || status === 'arrears') {
      ui = ui.filter(r => r.maturityDate && daysLate(r) > 0 && safeNumber(r.totalOutstanding) > 0);
    }
    if (status === '1-month-late') {
      ui = ui.filter(r => r.maturityDate && daysLate(r) >= 30 && safeNumber(r.totalOutstanding) > 0);
    }
    if (status === '3-months-late') {
      ui = ui.filter(r => r.maturityDate && daysLate(r) >= 90 && safeNumber(r.totalOutstanding) > 0);
    }
    if (status === 'due' || status === 'missed') {
      ui = ui.filter(r => r.maturityDate);
      if (status === 'due') {
        const in7 = new Date(asOf); in7.setDate(in7.getDate()+7);
        ui = ui.filter(r => new Date(r.maturityDate) >= asOf && new Date(r.maturityDate) <= in7 && safeNumber(r.totalOutstanding) > 0);
      } else {
        const past30 = new Date(asOf); past30.setDate(past30.getDate()-30);
        ui = ui.filter(r => new Date(r.maturityDate) < asOf && new Date(r.maturityDate) >= past30 && safeNumber(r.totalOutstanding) > 0);
      }
    }

    const table = {
      columns: [
        { key:'disbursementDate',     label:'Date' },
        { key:'borrowerName',         label:'Borrower Name' },
        { key:'productName',          label:'Loan Product' },
        { key:'principalAmount',      label:'Principal Amount', currency:true },
        { key:'outstandingPrincipal', label:'Outstanding Principal', currency:true },
        { key:'outstandingInterest',  label:'Outstanding Interest',  currency:true },
        { key:'outstandingFees',      label:'Outstanding Fees',      currency:true },
        { key:'outstandingPenalty',   label:'Outstanding Penalty',   currency:true },
        { key:'totalOutstanding',     label:'Total Outstanding',     currency:true },
        { key:'interestRateYear',     label:'Interest Rate/Year (%)' },
        { key:'termMonths',           label:'Loan Duration (Months)' },
        { key:'officerName',          label:'Loan Officer' }, // now populated
        { key:'status',               label:'Status' },
      ],
      rows: ui.map(r => ({
        ...r,
        outstandingPrincipal: r.totalOutstanding,
        outstandingInterest:  0,
        outstandingFees:      0,
        outstandingPenalty:   0,
      })),
    };

    const summary = {
      count: ui.length,
      principalSum: ui.reduce((s,r)=> s + safeNumber(r.principalAmount), 0),
      outstandingSum: ui.reduce((s,r)=> s + safeNumber(r.totalOutstanding), 0),
    };

    res.json({ status, asOf, summary, table, rows: ui });
  } catch (e) {
    console.error('loans status error:', e);
    res.status(500).json({ error: 'Failed to load loans by status' });
  }
};

