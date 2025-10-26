/* eslint-disable no-console */
const { Op, fn, col, cast, where: sqWhere } = require('sequelize');
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
    req?.context?.tenantId ||
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

  // Sum payments per loan up to asOf
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

  // Fetch loans
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

  // Compute outstanding
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

/* --------------------------- internal report service ----------------------- */
/**
 * We keep all domain/data logic here. Controllers become thin “illogic” glue:
 * parse inputs → call service → return HTTP.
 * NOTE: Everything uses existing helpers, so behavior is unchanged.
 */
const ReportsService = {
  async getFiltersData(req) {
    const [branches, officers, borrowers, products] = await Promise.all([
      Branch ? Branch.findAll({
        attributes: hasAttr(Branch, 'name') ? ['id', 'name'] : ['id'],
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
    return { branches, officers, borrowers, products };
  },

  async borrowersLoanSummaryData(req) {
    const { branchId, officerId, borrowerId, productId } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    const loanDateKey = pickAttrKey(Loan, ['createdAt', 'created_at']);
    const loanWhere = {
      ...(borrowerId && hasAttr(Loan, 'borrowerId') ? { borrowerId } : {}),
      ...(productId && hasAttr(Loan, 'productId') ? { productId } : {}),
      ...(branchId && hasAttr(Loan, 'branchId') ? { branchId } : {}),
      ...(officerId && (hasAttr(Loan, 'officerId') || hasAttr(Loan, 'loanOfficerId') || hasAttr(Loan, 'userId')) ?
        { [pickAttrKey(Loan, ['officerId','loanOfficerId','userId'])]: officerId } : {}),
      ...(startDate || endDate ? betweenRange(loanDateKey, startDate, endDate) : {}),
      ...tenantFilter(Loan, req),
    };

    const [loanCount, totalDisbursed] = await Promise.all([
      Loan ? countSafe(Loan, loanWhere) : 0,
      Loan ? sumSafe(Loan, ['amount', 'principal', 'principalAmount', 'loanAmount'], loanWhere) : 0,
    ]);

    let totalRepayments = 0;
    if (LoanPayment) {
      const lpAmountKey  = pickAttrKey(LoanPayment, ['amountPaid', 'amount', 'paidAmount', 'paymentAmount']);
      const lpDateKey    = pickAttrKey(LoanPayment, ['paymentDate', 'date', 'createdAt', 'created_at']);
      const lpStatusKey  = pickAttrKey(LoanPayment, ['status']);
      const lpAppliedKey = pickAttrKey(LoanPayment, ['applied']);
      const lpBranchKey  = pickAttrKey(LoanPayment, ['branchId','branch_id']);
      const lpOfficerKey = pickAttrKey(LoanPayment, ['officerId','loanOfficerId','userId']);
      const lpBorrowerK  = pickAttrKey(LoanPayment, ['borrowerId','borrower_id']);
      const lpProductK   = pickAttrKey(LoanPayment, ['productId','product_id']);

      const payWhere = {
        ...(lpStatusKey ? { [lpStatusKey]: 'approved' } : {}),
        ...(lpAppliedKey ? { [lpAppliedKey]: true } : {}),
        ...(lpDateKey ? betweenRange(lpDateKey, startDate, endDate) : {}),
        ...(branchId && lpBranchKey ? { [lpBranchKey]: branchId } : {}),
        ...(officerId && lpOfficerKey ? { [lpOfficerKey]: officerId } : {}),
        ...(borrowerId && lpBorrowerK ? { [lpBorrowerK]: borrowerId } : {}),
        ...(productId && lpProductK ? { [lpProductK]: productId } : {}),
        ...tenantFilter(LoanPayment, req),
      };
      totalRepayments = lpAmountKey ? await sumSafe(LoanPayment, [lpAmountKey], payWhere) : 0;
    }

    const outstandingRows = await computeOutstandingByLoan(new Date(), req);
    const outstandingBalance = outstandingRows.reduce((s, r) => s + safeNumber(r.outstanding), 0);

    const defaulterCount = 0;
    const arrearsAmount  = 0;

    return {
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
      scope:  scopeText({ branchId, officerId, borrowerId, productId }),
      welcome: 'Here is a friendly summary for your borrowers. Apply filters to narrow focus and export anytime!',
    };
  },

  async loansTrendsData(req) {
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
      if (m >= 0 && m < 12) monthly[m].loans += safeNumber(loanAmountKey ? l[loanAmountKey] : 0);
    });
    pays.forEach(p => {
      const dt = payDateKey ? p[payDateKey] : null;
      const m = dt ? new Date(dt).getMonth() : 0;
      if (m >= 0 && m < 12) monthly[m].repayments += safeNumber(payAmtKey ? p[payAmtKey] : 0);
    });

    return monthly;
  },

  async loansSummaryData(req) {
    const { productId, status } = req.query;
    const { startDate, endDate } = parseDates(req.query);

    if (!Loan) {
      return {
        summary: { loans: 0, disbursed: 0 },
        rows: [],
        period: periodText({ startDate, endDate }),
        scope: scopeText(req.query),
        welcome: 'No loans model available.',
      };
    }

    const idKey         = pickAttrKey(Loan, ['id']);
    const borrowerKey   = pickAttrKey(Loan, ['borrowerId','borrower_id']);
    const productKey    = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey     = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const statusKey     = pickAttrKey(Loan, ['status']);
    const createdAtKey  = pickAttrKey(Loan, ['createdAt','created_at']);
    const disbursedKey  = pickAttrKey(Loan, ['disbursementDate','releaseDate','startDate']);
    const currencyKey   = pickAttrKey(Loan, ['currency']);
    const branchKey     = pickAttrKey(Loan, ['branchId','branch_id']);

    const loanDateKey = createdAtKey || disbursedKey;

    const baseWhere = {
      ...(productId && productKey ? { [productKey]: productId } : {}),
      ...(loanDateKey ? betweenRange(loanDateKey, startDate, endDate) : {}),
      ...(req.query.branchId && branchKey ? { [branchKey]: req.query.branchId } : {}),
      ...tenantFilter(Loan, req),
    };

    let where = baseWhere;
    if (status && statusKey) {
      const statusField = Loan.rawAttributes[statusKey]?.field || statusKey;
      const want = String(status).toLowerCase();
      if (want === 'disbursed') {
        const orConds = [];
        if (disbursedKey) orConds.push({ [disbursedKey]: { [Op.ne]: null } });
        orConds.push(sqWhere(cast(col(statusField), 'text'), { [Op.iLike]: 'disbursed' }));
        where = { ...baseWhere, [Op.or]: orConds };
      } else {
        where = {
          ...baseWhere,
          [sqWhere(cast(col(statusField), 'text'), { [Op.iLike]: want })]: true,
        };
      }
    }

    const rawRows = await Loan.findAll({
      where,
      attributes: [idKey, borrowerKey, productKey, amountKey, statusKey, createdAtKey, disbursedKey, currencyKey].filter(Boolean),
      order: loanDateKey ? [[loanDateKey, 'DESC']] : undefined,
      limit: 500,
      raw: true,
    });

    const [count, totalDisbursed] = await Promise.all([
      countSafe(Loan, where),
      sumSafe(Loan, [amountKey || 'amount','principal','principalAmount','loanAmount'].filter(Boolean), where),
    ]);

    const borrowerIds = Array.from(new Set(rawRows.map(r => r[borrowerKey]).filter(Boolean)));
    const productIds  = Array.from(new Set(rawRows.map(r => r[productKey]).filter(Boolean)));

    let borrowersById = {};
    if (Borrower && borrowerIds.length) {
      const bNameKey = pickAttrKey(Borrower, ['name']);
      const bList = await Borrower.findAll({
        where: { id: { [Op.in]: borrowerIds }, ...tenantFilter(Borrower, req) },
        attributes: ['id', ...(bNameKey ? [bNameKey] : [])],
        raw: true,
      });
      borrowersById = Object.fromEntries(
        bList.map(b => [String(b.id), b[bNameKey] || b.name || ''])
      );
    }

    let productsById = {};
    if (LoanProduct && productIds.length) {
      const pNameKey = pickAttrKey(LoanProduct, ['name']);
      const pList = await LoanProduct.findAll({
        where: { id: { [Op.in]: productIds }, ...tenantFilter(LoanProduct, req) },
        attributes: ['id', ...(pNameKey ? [pNameKey] : [])],
        raw: true,
      });
      productsById = Object.fromEntries(
        pList.map(p => [String(p.id), p[pNameKey] || p.name || ''])
      );
    }

    const idK = idKey, bK = borrowerKey, pK = productKey, aK = amountKey, sK = statusKey, cAtK = createdAtKey, dK = disbursedKey, curK = currencyKey;
    const uiRows = rawRows.map(r => ({
      id: r[idK],
      borrowerId: r[bK],
      borrowerName: borrowersById[String(r[bK])] || '—',
      productId: r[pK],
      productName: productsById[String(r[pK])] || '—',
      amount: r[aK],
      status: r[sK],
      createdAt: r[cAtK],
      disbursementDate: r[dK] || r[cAtK],
      currency: r[curK] || 'TZS',
    }));

    return {
      summary: { loans: count, disbursed: totalDisbursed },
      rows: uiRows,
      rawRows, // exposed for exports to reuse
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
      welcome: 'This is your live loan register — filter, review, and export with confidence.',
    };
  },

  async loanProductsSummaryData(req) {
    if (!Loan) {
      return {
        rows: [],
        table: {
          columns: [
            { key: 'product', label: 'Product' },
            { key: 'loans',   label: 'Loans' },
            { key: 'amount',  label: 'Amount', currency: true },
          ],
          rows: [],
        },
        period: periodText(parseDates(req.query)),
        scope: scopeText(req.query),
        welcome: 'No loans model available.',
      };
    }

    const { startDate, endDate } = parseDates(req.query);
    const productKey   = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey    = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);
    const disbDateKey  = pickAttrKey(Loan, ['disbursementDate','disbursedAt','releaseDate','startDate']);
    const branchKey    = pickAttrKey(Loan, ['branchId','branch_id']);
    const dateKey = disbDateKey || createdAtKey;

    const where = {
      ...(dateKey ? betweenRange(dateKey, startDate, endDate) : {}),
      ...(req.query.branchId && branchKey ? { [branchKey]: req.query.branchId } : {}),
      ...tenantFilter(Loan, req),
    };

    const attrs = [productKey, amountKey].filter(Boolean);
    if (!productKey) {
      return {
        rows: [],
        table: {
          columns: [
            { key: 'product', label: 'Product' },
            { key: 'loans',   label: 'Loans' },
            { key: 'amount',  label: 'Amount', currency: true },
          ],
          rows: [],
        },
        period: periodText({ startDate, endDate }),
        scope: scopeText(req.query),
        welcome: 'This dataset has no product reference; cannot summarize by product.',
      };
    }

    const items = await Loan.findAll({
      where,
      attributes: attrs,
      raw: true,
      limit: 25000,
    });

    const agg = new Map(); // productId -> { loans, amount }
    items.forEach(r => {
      const pid = String(r[productKey] ?? '');
      if (!pid) return;
      const a = agg.get(pid) || { loans: 0, amount: 0 };
      a.loans += 1;
      a.amount += safeNumber(r[amountKey]);
      agg.set(pid, a);
    });

    let namesById = {};
    if (LoanProduct && agg.size) {
      const pNameKey = pickAttrKey(LoanProduct, ['name','productName','title']);
      const ids = Array.from(agg.keys());
      const rows = await LoanProduct.findAll({
        where: { id: { [Op.in]: ids } , ...tenantFilter(LoanProduct, req)},
        attributes: ['id', ...(pNameKey ? [pNameKey] : [])],
        raw: true,
      });
      rows.forEach(p => {
        namesById[String(p.id)] = (p[pNameKey] || p.name || p.productName || '').trim() || `#${p.id}`;
      });
    }

    const uiRows = Array.from(agg.entries())
      .map(([pid, v]) => ({
        productId: pid,
        product: namesById[pid] || `#${pid}`,
        loans: v.loans,
        amount: v.amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      rows: uiRows,
      table: {
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'loans',   label: 'Loans' },
          { key: 'amount',  label: 'Amount', currency: true },
        ],
        rows: uiRows,
      },
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
      welcome: 'Product mix and totals.',
    };
  },

  async collectionsSummaryData(req) {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) {
      return {
        summary:{ total:0, receipts:0 },
        table: { columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[
          { metric:'Total Collections', value:0, currency:true },
          { metric:'Receipts Count', value:0 }
        ]},
        period: periodText({startDate,endDate}),
        scope: scopeText(req.query),
        welcome: 'Collections at a glance — totals and receipts count.',
      };
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

    return {
      summary:{ total, receipts },
      table: { columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[
        { metric:'Total Collections', value: total, currency:true },
        { metric:'Receipts Count', value: receipts }
      ]},
      period: periodText({startDate,endDate}),
      scope: scopeText(req.query),
      welcome: 'Collections at a glance — totals and receipts count.',
    };
  },

  async collectorSummaryData(req) {
    const { startDate, endDate } = parseDates(req.query);
    if (!LoanPayment) {
      return {
        summary:{ total:0 },
        table:{ columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[{ metric:'Total Collected', value:0, currency:true }]},
        period: periodText({startDate,endDate}),
        scope: scopeText(req.query),
      };
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
    return {
      summary:{ total },
      table:{ columns:[{key:'metric',label:'Metric'},{key:'value',label:'Value'}], rows:[{ metric:'Total Collected', value: total, currency:true }]},
      period: periodText({ startDate, endDate }),
      scope: scopeText(req.query),
      welcome: 'Collector summary — filter by officer to drill down.',
    };
  },

  async disbursementsSummaryData(req) {
    const { startDate, endDate } = parseDates(req.query);

    const dateKey    = pickAttrKey(Loan, ['disbursementDate','disbursedAt','releaseDate','startDate','createdAt','created_at']);
    const statusKey  = pickAttrKey(Loan, ['status']);
    const disbDateK  = pickAttrKey(Loan, ['disbursementDate','disbursement_date']);
    const branchKey  = pickAttrKey(Loan, ['branchId','branch_id']);
    const productKey = pickAttrKey(Loan, ['productId','product_id']);

    const baseWhere = {
      ...(dateKey ? betweenRange(dateKey, startDate, endDate) : {}),
      ...(req.query.branchId && branchKey ? { [branchKey]: req.query.branchId } : {}),
      ...(req.query.productId && productKey ? { [productKey]: req.query.productId } : {}),
      ...tenantFilter(Loan, req),
    };

    const orConds = [];
    if (disbDateK) orConds.push({ [disbDateK]: { [Op.ne]: null } });
    if (statusKey) {
      const statusField = Loan.rawAttributes[statusKey]?.field || statusKey;
      orConds.push(sqWhere(cast(col(statusField), 'text'), { [Op.iLike]: 'disbursed' }));
    }

    const where = orConds.length ? { ...baseWhere, [Op.or]: orConds } : baseWhere;

    const [count, total] = await Promise.all([
      Loan ? countSafe(Loan, where) : 0,
      Loan ? sumSafe(Loan, ['amount','principal','principalAmount','loanAmount'], where) : 0,
    ]);

    return {
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
    };
  },

  async loansDisbursedListData(req) {
    if (!Loan) return [];

    const { startDate, endDate } = parseDates(req.query);

    const idKey         = pickAttrKey(Loan, ['id']);
    const borrowerKey   = pickAttrKey(Loan, ['borrowerId','borrower_id']);
    const productKey    = pickAttrKey(Loan, ['productId','product_id']);
    const amountKey     = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const currencyKey   = pickAttrKey(Loan, ['currency']);
    const statusKey     = pickAttrKey(Loan, ['status']);
    const startKey      = pickAttrKey(Loan, ['startDate','start_date','createdAt','created_at']);
    const disbDateKey   = pickAttrKey(Loan, ['disbursementDate','disbursement_date','disbursedAt','releaseDate']);
    const methodKey     = pickAttrKey(Loan, ['disbursementMethod','disbursement_method']);
    const officerKey    = pickAttrKey(Loan, ['officerId','loanOfficerId','userId','disbursedBy','disbursed_by']);
    const branchKey     = pickAttrKey(Loan, ['branchId','branch_id']);
    const refKey        = pickAttrKey(Loan, ['reference','ref','code']);

    const rateKey       = pickAttrKey(Loan, ['interestRate','rate','annualInterestRate']);
    const termMonthsKey = pickAttrKey(Loan, ['termMonths','tenor','duration','loanTermMonths','term_months']);

    const dateKey = disbDateKey || startKey;

    let where = {
      ...(dateKey ? betweenRange(dateKey, startDate, endDate) : {}),
      ...(req.query.productId && productKey ? { [productKey]: req.query.productId } : {}),
      ...(req.query.borrowerId && borrowerKey ? { [borrowerKey]: req.query.borrowerId } : {}),
      ...(req.query.branchId && branchKey ? { [branchKey]: req.query.branchId } : {}),
      ...tenantFilter(Loan, req),
    };

    const orConds = [];
    if (disbDateKey) orConds.push({ [disbDateKey]: { [Op.ne]: null } });
    if (statusKey) {
      const statusField = Loan.rawAttributes[statusKey]?.field || statusKey;
      orConds.push(sqWhere(cast(col(statusField), 'text'), { [Op.iLike]: 'disbursed' }));
    }
    where = orConds.length ? { ...where, [Op.or]: orConds } : where;

    if ((req.query.minAmount || req.query.maxAmount) && amountKey) {
      const minA = Number(req.query.minAmount || 0);
      const maxA = Number(req.query.maxAmount || Number.MAX_SAFE_INTEGER);
      where = { ...where, [amountKey]: { [Op.between]: [minA, maxA] } };
    }

    if (req.query.officerId && officerKey) where = { ...where, [officerKey]: req.query.officerId };

    const attrs = [
      idKey, borrowerKey, productKey, amountKey, currencyKey, statusKey,
      startKey, disbDateKey, methodKey, officerKey, branchKey, refKey,
      rateKey, termMonthsKey,
    ].filter(Boolean);

    let rows = await Loan.findAll({
      where,
      attributes: attrs,
      order: dateKey ? [[dateKey, 'DESC']] : undefined,
      limit: 2000,
      raw: true,
    });

    const loanIds     = rows.map(r => r[idKey]).filter(Boolean);
    const borrowerIds = Array.from(new Set(rows.map(r => r[borrowerKey]).filter(Boolean))).map(String);
    const productIds  = Array.from(new Set(rows.map(r => r[productKey]).filter(Boolean))).map(String);
    const branchIds   = Array.from(new Set(rows.map(r => r[branchKey]).filter(Boolean))).map(String);

    let borrowersById = {}, borrowerPhoneById = {}, borrowerOfficerMap = {};
    if (Borrower && borrowerIds.length) {
      const bNameKey   = pickAttrKey(Borrower, ['name','fullName']);
      const bPhoneKey  = pickAttrKey(Borrower, ['phone','phoneNumber','mobile','msisdn','tel']);
      const bOfficerK1 = pickAttrKey(Borrower, ['loan_officer_id','officerId','loanOfficerId','userId']);
      const bList = await Borrower.findAll({
        where: { id: { [Op.in]: borrowerIds }, ...tenantFilter(Borrower, req) },
        attributes: ['id', ...(bNameKey ? [bNameKey] : []), ...(bPhoneKey ? [bPhoneKey] : []), ...(bOfficerK1 ? [bOfficerK1] : [])],
        raw: true,
      });
      bList.forEach(b => {
        const id = String(b.id);
        borrowersById[id]      = (b[bNameKey] ?? b.name ?? '').trim() || '—';
        borrowerPhoneById[id]  = (b[bPhoneKey] ?? '').trim() || '—';
        if (bOfficerK1 && b[bOfficerK1]) borrowerOfficerMap[id] = String(b[bOfficerK1]);
      });
    }

    let productsById = {};
    if (LoanProduct && productIds.length) {
      const pNameKey = pickAttrKey(LoanProduct, ['name','productName']);
      const pList = await LoanProduct.findAll({
        where: { id: { [Op.in]: productIds }, ...tenantFilter(LoanProduct, req) },
        attributes: ['id', ...(pNameKey ? [pNameKey] : [])],
        raw: true,
      });
      pList.forEach(p => { productsById[String(p.id)] = (p[pNameKey] || p.name || '').trim(); });
    }

    let branchesById = {};
    if (Branch && branchIds.length) {
      const brNameKey = pickAttrKey(Branch, ['name','branchName','title']);
      const brs = await Branch.findAll({
        where: { id: { [Op.in]: branchIds }, ...tenantFilter(Branch, req) },
        attributes: ['id', ...(brNameKey ? [brNameKey] : [])],
        raw: true,
      });
      brs.forEach(b => { branchesById[String(b.id)] = (b[brNameKey] || b.name || '').trim(); });
    }

    const officerIds = new Set(
      rows.map(r => (officerKey ? r[officerKey] : null)).filter(Boolean).map(String)
    );
    rows.forEach(r => {
      const bid = borrowerKey ? r[borrowerKey] : null;
      if (!officerKey && bid && borrowerOfficerMap[String(bid)]) {
        officerIds.add(borrowerOfficerMap[String(bid)]);
      }
    });

    let officersById = {};
    if (User && officerIds.size) {
      const uNameKey  = pickAttrKey(User, ['name','fullName']);
      const uEmailKey = pickAttrKey(User, ['email']);
      const uList = await User.findAll({
        where: { id: { [Op.in]: Array.from(officerIds) }, ...tenantFilter(User, req) },
        attributes: ['id', ...(uNameKey ? [uNameKey] : []), ...(uEmailKey ? [uEmailKey] : [])],
        raw: true,
      });
      uList.forEach(u => {
        officersById[String(u.id)] = (u[uNameKey] || u.name || u[uEmailKey] || u.email || '').trim();
      });
    }

    let scheduleAggByLoan = new Map();
    let nextDueByLoan     = new Map();

    if (db.LoanSchedule && loanIds.length) {
      const LS = db.LoanSchedule;
      const lsLoanId   = pickAttrKey(LS, ['loanId','loan_id']);
      const lsDue      = pickAttrKey(LS, ['due_date','dueDate']);
      const lsPaidNum  = pickAttrKey(LS, ['paid']);
      const lsStatus   = pickAttrKey(LS, ['status']);
      const lsPrin     = pickAttrKey(LS, ['principal']);
      const lsInt      = pickAttrKey(LS, ['interest']);
      const lsFees     = pickAttrKey(LS, ['fees']);
      const lsPen      = pickAttrKey(LS, ['penalties']);
      const lsPrinPaid = pickAttrKey(LS, ['principal_paid']);
      const lsIntPaid  = pickAttrKey(LS, ['interest_paid']);
      const lsFeesPaid = pickAttrKey(LS, ['fees_paid']);
      const lsPenPaid  = pickAttrKey(LS, ['penalties_paid']);

      const aggRows = await LS.findAll({
        where: { [lsLoanId]: { [Op.in]: loanIds } , ...tenantFilter(LS, req) },
        attributes: [
          [col(LS.rawAttributes[lsLoanId]?.field || lsLoanId), 'loanId'],
          ...(lsPrin     ? [[fn('sum', col(LS.rawAttributes[lsPrin]?.field     || lsPrin)),     'schedPrincipal']] : []),
          ...(lsInt      ? [[fn('sum', col(LS.rawAttributes[lsInt]?.field      || lsInt)),      'schedInterest']]  : []),
          ...(lsFees     ? [[fn('sum', col(LS.rawAttributes[lsFees]?.field     || lsFees)),     'schedFees']]      : []),
          ...(lsPen      ? [[fn('sum', col(LS.rawAttributes[lsPen]?.field      || lsPen)),      'schedPenalty']]   : []),
          ...(lsPrinPaid ? [[fn('sum', col(LS.rawAttributes[lsPrinPaid]?.field || lsPrinPaid)), 'paidPrincipal']]  : []),
          ...(lsIntPaid  ? [[fn('sum', col(LS.rawAttributes[lsIntPaid]?.field  || lsIntPaid)),  'paidInterest']]   : []),
          ...(lsFeesPaid ? [[fn('sum', col(LS.rawAttributes[lsFeesPaid]?.field || lsFeesPaid)), 'paidFees']]       : []),
          ...(lsPenPaid  ? [[fn('sum', col(LS.rawAttributes[lsPenPaid]?.field  || lsPenPaid)),  'paidPenalty']]    : []),
        ],
        group: [col(LS.rawAttributes[lsLoanId]?.field || lsLoanId)],
        raw: true,
      });

      aggRows.forEach(r => {
        scheduleAggByLoan.set(String(r.loanId), {
          schedPrincipal: Number(r.schedPrincipal || 0),
          schedInterest:  Number(r.schedInterest  || 0),
          schedFees:      Number(r.schedFees      || 0),
          schedPenalty:   Number(r.schedPenalty   || 0),
          paidPrincipal:  Number(r.paidPrincipal  || 0),
          paidInterest:   Number(r.paidInterest   || 0),
          paidFees:       Number(r.paidFees       || 0),
          paidPenalty:    Number(r.paidPenalty    || 0),
        });
      });

      const unpaidCond = {
        [Op.or]: [
          ...(lsPaidNum ? [{ [lsPaidNum]: 0 }] : []),
          ...(lsStatus  ? [{ [lsStatus]: { [Op.notILike]: 'paid' } }] : []),
        ],
      };

      const dueRows = await LS.findAll({
        where: {
          [lsLoanId]: { [Op.in]: loanIds },
          ...unpaidCond,
          ...tenantFilter(LS, req),
        },
        attributes: [
          [col(LS.rawAttributes[lsLoanId]?.field || lsLoanId), 'loanId'],
          [fn('min', col(LS.rawAttributes[lsDue]?.field || lsDue)), 'nextDue'],
        ],
        group: [col(LS.rawAttributes[lsLoanId]?.field || lsLoanId)],
        raw: true,
      });

      dueRows.forEach(r => nextDueByLoan.set(String(r.loanId), r.nextDue));
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    let uiRows = rows.map(r => {
      const loanId     = r[idKey];
      const borrowerId = borrowerKey ? r[borrowerKey] : null;
      const officerId  =
        (officerKey && r[officerKey]) ? String(r[officerKey]) :
        (borrowerId && borrowerOfficerMap[String(borrowerId)]) || null;

      const principal = Number(r[amountKey] || 0);
      const sched = scheduleAggByLoan.get(String(loanId)) || {
        schedPrincipal: 0, schedInterest: 0, schedFees: 0, schedPenalty: 0,
        paidPrincipal: 0,   paidInterest: 0,   paidFees: 0,   paidPenalty: 0,
      };

      const outPrin = Math.max(0, sched.schedPrincipal - sched.paidPrincipal);
      const outInt  = Math.max(0, sched.schedInterest  - sched.paidInterest);
      const outFee  = Math.max(0, sched.schedFees      - sched.paidFees);
      const outPen  = Math.max(0, sched.schedPenalty   - sched.paidPenalty);
      const totalOutstanding = outPrin + outInt + outFee + outPen;

      const ratePct = r[rateKey] != null ? Number(r[rateKey]) : null;
      const months  = r[termMonthsKey] != null ? Number(r[termMonthsKey]) : null;

      let interestAmount = (sched.schedInterest || null);
      if (interestAmount == null && ratePct != null && months != null) {
        interestAmount = Math.max(0, Math.round(principal * (ratePct/100) * (months/12)));
      }

      const disbDate  = disbDateKey ? r[disbDateKey] : (startKey ? r[startKey] : null);
      const productId = productKey ? r[productKey] : null;
      const branchId  = branchKey ? r[branchKey] : null;

      return {
        id: loanId,
        date: disbDate,
        borrowerId,
        borrowerName: borrowerId ? (borrowersById[String(borrowerId)] || '—') : '—',
        phone: borrowerId ? (borrowerPhoneById[String(borrowerId)] || '—') : '—',
        productId,
        productName: productId ? (productsById[String(productId)] || '—') : '—',

        principalAmount: principal,
        interestAmount,

        outstandingPrincipal: outPrin,
        outstandingInterest:  outInt,
        outstandingFees:      outFee,
        outstandingPenalty:   outPen,
        totalOutstanding,

        interestRateYear: ratePct,
        loanDurationMonths: months,

        officerId,
        officerName: officerId ? (officersById[officerId] || '—') : '—',
        branchId,
        branchName: branchId ? (branchesById[String(branchId)] || '—') : '—',

        currency: r[currencyKey] || 'TZS',
        status: r[statusKey] || null,
        reference: refKey ? (r[refKey] || null) : null,
        disbursementMethod: methodKey ? (r[methodKey] || null) : null,

        nextDueDate: nextDueByLoan.get(String(loanId)) || null,
      };
    });

    if (req.query.officerId && !officerKey) {
      uiRows = uiRows.filter(r => String(r.officerId || '') === String(req.query.officerId));
    }

    if (q) {
      uiRows = uiRows.filter(r =>
        String(r.borrowerName || '').toLowerCase().includes(q) ||
        String(r.phone || '').toLowerCase().includes(q) ||
        String(r.productName || '').toLowerCase().includes(q) ||
        String(r.reference || '').toLowerCase().includes(q) ||
        String(r.id || '').toLowerCase().includes(q)
      );
    }

    return uiRows;
  },

  async outstandingReportData(req) {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(asOf, req);
    const total = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);
    return {
      rows,
      totals: { outstanding: total },
      asOf,
      scope: scopeText(req.query),
      welcome: 'Snapshot of outstanding portfolio.'
    };
  },

  async parSummaryData(req) {
    const { asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(asOf, req);
    const olp = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

    return {
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
    };
  },

  async atAGlanceData(req) {
    const { startDate, endDate, asOf } = parseDates(req.query);
    const rows = await computeOutstandingByLoan(asOf, req);
    const outstanding = rows.reduce((s,r)=>s+safeNumber(r.outstanding),0);

    return {
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
    };
  },

  // Small utility for exports to reuse the same base query as the UI list
  async loansListRawForExport(req) {
    // Reuse loansSummaryData base filtering/attrs, but return raw rows only.
    const data = await this.loansSummaryData(req);
    // data.rawRows is included by loansSummaryData
    return data.rawRows || [];
  }
};

/* --------------------------------- FILTERS --------------------------------- */
exports.getFilters = async (req, res) => {
  try {
    const data = await ReportsService.getFiltersData(req);
    res.json({ ...data, welcome: 'Welcome! Choose filters and export whenever ready.' });
  } catch (e) {
    console.error('filters error:', e);
    res.json({ branches: [], officers: [], borrowers: [], products: [], welcome: 'Welcome!' });
  }
};

/* ------------------------- BORROWERS (loan summary) ------------------------ */
exports.borrowersLoanSummary = async (req, res) => {
  try {
    const payload = await ReportsService.borrowersLoanSummaryData(req);
    res.json(payload);
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
    const monthly = await ReportsService.loansTrendsData(req);
    res.json(monthly);
  } catch (e) {
    console.error('Trend error:', e);
    res.json([]);
  }
};

/* ------------------------- Loans summary/register -------------------------- */
exports.loansSummary = async (req, res) => {
  try {
    const data = await ReportsService.loansSummaryData(req);
    res.json(data);
  } catch (e) {
    console.error('loansSummary error:', e);
    res.json({
      summary: { loans: 0, disbursed: 0 },
      rows: [],
      period: periodText({}),
      scope: scopeText({}),
      welcome: 'No loans in this range.',
    });
  }
};

/* ------------------------------- Loan products ----------------------------- */
exports.loanProductsSummary = async (req, res) => {
  try {
    const data = await ReportsService.loanProductsSummaryData(req);
    res.json(data);
  } catch (e) {
    console.error('loanProductsSummary error:', e);
    res.json({
      rows: [],
      table: { columns: [
        { key: 'product', label: 'Product' },
        { key: 'loans',   label: 'Loans' },
        { key: 'amount',  label: 'Amount', currency: true },
      ], rows: [] },
      period: periodText(parseDates(req.query)),
      scope: scopeText(req.query),
      welcome: 'Could not compute product summary.',
    });
  }
};

/* ---------------------------------- Exports -------------------------------- */
exports.loansExportCSV = async (req, res) => {
  try {
    // Reuse the same filtering logic as loansSummary (raw rows)
    const list = await ReportsService.loansListRawForExport(req);

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
    // Reuse the same filtering logic as loansSummary (raw rows)
    const list = await ReportsService.loansListRawForExport(req);

    // Determine createdAt key from existing Loan model for date printing
    const createdAtKey = pickAttrKey(Loan, ['createdAt','created_at']);
    const amountKey    = pickAttrKey(Loan, ['amount','principal','principalAmount','loanAmount']);
    const idKey        = pickAttrKey(Loan, ['id']);
    const borrowerKey  = pickAttrKey(Loan, ['borrowerId','borrower_id']);
    const productKey   = pickAttrKey(Loan, ['productId','product_id']);
    const statusKey    = pickAttrKey(Loan, ['status']);

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
        `Loan #${idKey? l[idKey]:''} • Borrower ${borrowerKey? l[borrowerKey]:''} • Product ${productKey? l[productKey]:''} • Amount ${amt} • ${statusKey? (l[statusKey]||''):''} • ${when}`
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
    const data = await ReportsService.collectionsSummaryData(req);
    res.json(data);
  } catch (e) {
    console.error('collectionsSummary error:', e);
    res.json({ summary:{total:0,receipts:0}, table:{ rows:[] }, period: periodText({}), scope: scopeText({}) });
  }
};

exports.collectorSummary = async (req, res) => {
  try {
    const data = await ReportsService.collectorSummaryData(req);
    res.json(data);
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
    const data = await ReportsService.disbursementsSummaryData(req);
    res.json(data);
  } catch (e) {
    console.error('disbursementsSummary error:', e);
    res.json({ summary:{ count:0, total:0 }, table:{ rows:[] }, period: periodText({}), scope: scopeText({}) });
  }
};

/* ---------------------- Disbursed loans register (rich) -------------------- */
exports.loansDisbursedList = async (req, res) => {
  try {
    const uiRows = await ReportsService.loansDisbursedListData(req);
    res.json(uiRows);
  } catch (e) {
    console.error('loansDisbursedList error:', e);
    res.status(500).json({ error: 'Failed to load disbursed loans' });
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
    const data = await ReportsService.outstandingReportData(req);
    res.json(data);
  } catch (e) {
    console.error('outstandingReport error:', e);
    res.json({ rows:[], totals:{ outstanding:0 }, asOf: parseDates(req.query).asOf, welcome: 'No outstanding data yet.' });
  }
};

/* ---------------------------------- PAR ------------------------------------ */
exports.parSummary = async (req, res) => {
  try {
    const data = await ReportsService.parSummaryData(req);
    res.json(data);
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
  try {
    const data = await ReportsService.atAGlanceData(req);
    res.json(data);
  } catch (e) {
    console.error('atAGlance error:', e);
    res.json({
      asOf: new Date(),
      period: periodText({}),
      cards: [],
      trends: [],
      welcome: 'A friendly dashboard snapshot.'
    });
  }
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
