const { Op } = require('sequelize');
const { LoanProduct, sequelize } = require('../models');

/* ----------------------------- helpers ----------------------------- */
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

const pickFirst = (obj, ...keys) => {
  for (const k of keys) {
    if (k.includes('.')) {
      // support meta.term style
      const [a, b] = k.split('.');
      if (obj?.[a]?.[b] !== undefined && obj[a][b] !== null && obj[a][b] !== '') return obj[a][b];
    } else if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      return obj[k];
    }
  }
  return undefined;
};

/** normalize booleans for active/inactive */
const readStatus = (body) => {
  const boolActive = pickFirst(body, 'active', 'isActive', 'enabled', 'is_enabled');
  if (typeof boolActive === 'boolean') return boolActive ? 'active' : 'inactive';
  if (String(body.status || '').toLowerCase() === 'inactive') return 'inactive';
  if (String(body.status || '').toLowerCase() === 'active') return 'active';
  return 'active';
};

/** build a safe payload from aliases */
const buildPayload = (body, isUpdate = false) => {
  const status = readStatus(body);

  // interest
  const interestRate = num(pickFirst(body, 'interestRate', 'interest_rate', 'rate_percent'));

  // interest period
  const interestPeriod = String(
    pickFirst(body, 'interestPeriod', 'interest_period', 'period', 'periodicity', 'meta.interestPeriod') ||
    'monthly'
  ).toLowerCase();

  // term + unit (aliases)
  const termValue = num(
    pickFirst(body, 'term', 'term_value', 'tenor', 'tenure', 'duration', 'period_count', 'loanTerm', 'repayment_term', 'meta.term')
  );
  const termUnit = String(
    pickFirst(body, 'termUnit', 'term_unit', 'termType', 'term_type', 'unit', 'duration_unit', 'tenor_unit', 'tenure_unit', 'period_unit', 'loanTermUnit', 'repayment_term_unit', 'meta.termUnit') ||
    'months'
  ).toLowerCase();

  // principals
  const minPrincipal = num(pickFirst(body, 'minPrincipal', 'principalMin', 'principal_min', 'min_amount', 'minimum_principal', 'minPrincipal'));
  const maxPrincipal = num(pickFirst(body, 'maxPrincipal', 'principalMax', 'principal_max', 'max_amount', 'maximum_principal', 'maxPrincipal'));

  // fees
  const feeType = String(pickFirst(body, 'feeType', 'meta.feeType') || (pickFirst(body, 'feePercent', 'fee_percent', 'fees_percent', 'feeRate', 'rate_fee') != null ? 'percent' : 'amount')).toLowerCase();
  const feeAmount = num(pickFirst(body, 'feeAmount', 'fees', 'fees_total', 'fee', 'fee_amount', 'meta.fees'));
  const feePercent = num(pickFirst(body, 'feePercent', 'fee_percent', 'fees_percent', 'feeRate', 'rate_fee', 'meta.feePercent'));

  const payload = {
    name: body.name,
    code: body.code,
    status,

    interestMethod: body.interestMethod || 'flat',
    interestRate: interestRate ?? 0,

    interestPeriod,
    termValue,
    termUnit,

    minPrincipal,
    maxPrincipal,

    // legacy mins/maxes (keep if present)
    minTermMonths: body.minTermMonths ?? null,
    maxTermMonths: body.maxTermMonths ?? null,

    penaltyRate: num(body.penaltyRate),

    // normalized fee fields
    feeType: feeType === 'percent' ? 'percent' : 'amount',
    feeAmount: feeType === 'amount' ? (feeAmount ?? 0) : 0,
    feePercent: feeType === 'percent' ? (feePercent ?? 0) : 0,

    // legacy fees array preserved (if client sends)
    fees: Array.isArray(body.fees) ? body.fees : [],

    eligibility: body.eligibility || {},
    meta: {
      ...(body.meta || {}),
      term: termValue ?? null,
      termUnit,
      interestPeriod,
      feeType: feeType === 'percent' ? 'percent' : 'amount',
      fees: feeType === 'amount' ? (feeAmount ?? 0) : null,
      feePercent: feeType === 'percent' ? (feePercent ?? 0) : null,
    },
  };

  // On update we only pass keys that were provided
  if (isUpdate) {
    const out = {};
    Object.keys(payload).forEach((k) => {
      if (k in body || ['interestPeriod','termValue','termUnit','feeType','feeAmount','feePercent'].includes(k) || k === 'meta') {
        out[k] = payload[k];
      }
    });
    return out;
  }
  return payload;
};

/** serialize DB row for the frontend with friendly aliases as well */
const serialize = (row) => {
  const r = row.toJSON ? row.toJSON() : row;

  const dto = {
    id: r.id,
    name: r.name,
    code: r.code,
    status: r.status,

    interestMethod: r.interestMethod,
    interestRate: Number(r.interestRate ?? 0),
    interestPeriod: r.interestPeriod || r.meta?.interestPeriod || 'monthly',

    term: r.termValue ?? r.meta?.term ?? null,
    termUnit: r.termUnit || r.meta?.termUnit || 'months',

    principalMin: r.minPrincipal ?? null,
    principalMax: r.maxPrincipal ?? null,

    minTermMonths: r.minTermMonths ?? null,
    maxTermMonths: r.maxTermMonths ?? null,

    penaltyRate: r.penaltyRate ?? null,

    // fees — prefer normalized
    feeType: r.feeType || r.meta?.feeType || 'amount',
    fees: r.feeType === 'amount' ? Number(r.feeAmount ?? r.meta?.fees ?? 0) : 0,
    feePercent: r.feeType === 'percent' ? Number(r.feePercent ?? r.meta?.feePercent ?? 0) : null,

    // keep legacy array as-is
    feesArray: r.fees || [],

    eligibility: r.eligibility || {},
    meta: r.meta || {},
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null,
  };

  // also expose snake_case/alt aliases so older UIs keep working
  dto.principal_min = dto.principalMin;
  dto.principal_max = dto.principalMax;
  dto.min_amount = dto.principalMin;
  dto.max_amount = dto.principalMax;
  dto.interest_period = dto.interestPeriod;
  dto.term_unit = dto.termUnit;

  // if percent fee present, expose common aliases
  if (dto.feeType === 'percent' && dto.feePercent != null) {
    dto.fee_percent = dto.feePercent;
    dto.fees_percent = dto.feePercent;
    dto.feeRate = dto.feePercent;
    dto.rate_fee = dto.feePercent;
  } else {
    dto.fee_amount = dto.fees;
    dto.fees_total = dto.fees;
    dto.fee = dto.fees;
  }

  return dto;
};

/* ------------------------------ actions ------------------------------ */
exports.list = async (req, res) => {
  try {
    const { q = '', status, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (status) where.status = status;

    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { code: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const { rows, count } = await LoanProduct.findAndCountAll({
      where,
      // IMPORTANT: physical column to avoid "createdAt" error
      order: [[sequelize.col('created_at'), 'DESC']],
      limit,
      offset,
    });

    res.json({
      items: rows.map(serialize),
      total: count,
      page: Number(page),
      limit,
    });
  } catch (e) {
    console.error('LoanProduct list error:', e);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

exports.get = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(row));
  } catch (e) {
    console.error('LoanProduct get error:', e);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = buildPayload(req.body, false);

    if (!payload.name || !payload.code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const created = await LoanProduct.create(payload);
    res.status(201).json(serialize(created));
  } catch (e) {
    console.error('LoanProduct create error:', e);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

exports.update = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const payload = buildPayload(req.body, true);
    await row.update(payload);
    res.json(serialize(row));
  } catch (e) {
    console.error('LoanProduct update error:', e);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

exports.remove = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) {
    console.error('LoanProduct delete error:', e);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    const row = await LoanProduct.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const next = row.status === 'active' ? 'inactive' : 'active';
    await row.update({ status: next });
    res.json({ id: row.id, status: row.status });
  } catch (e) {
    console.error('LoanProduct toggle error:', e);
    res.status(500).json({ error: 'Failed to toggle status' });
  }
};
