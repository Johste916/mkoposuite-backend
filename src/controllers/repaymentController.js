// controllers/repaymentController.js
const { Op } = require('sequelize');
const { LoanRepayment, Loan, Borrower, LoanSchedule, sequelize } = require('../models');

/** Build a receipt-friendly shape */
const shapeReceipt = (repayment, allocation = []) => {
  const totals = allocation.reduce(
    (acc, a) => ({
      principal: acc.principal + (a.principal || 0),
      interest:  acc.interest  + (a.interest  || 0),
      fees:      acc.fees      + (a.fees      || 0),
      penalties: acc.penalties + (a.penalties || 0),
    }),
    { principal: 0, interest: 0, fees: 0, penalties: 0 }
  );

  const loan = repayment.Loan || {};
  const borrower = loan.Borrower || {};

  return {
    id: repayment.id,
    receiptNo: repayment.receiptNo || `RCPT-${repayment.id}`,
    date: repayment.date,
    amount: Number(repayment.amount || 0),
    currency: repayment.currency || loan.currency || 'TZS',
    method: repayment.method || 'cash',
    reference: repayment.reference || null,
    notes: repayment.notes || null,
    loan: {
      id: loan.id,
      reference: loan.reference || `L-${loan.id}`,
      borrowerName: borrower?.name || '',
    },
    postedBy: repayment.postedBy
      ? { name: repayment.postedByName || 'User', email: repayment.postedByEmail || '' }
      : null,
    allocation,
    totals,
  };
};

/** Internal: compute allocation from schedule */
async function computeAllocations({ loanId, amount, date, strategy = 'oldest_due_first', customOrder, waivePenalties = false }) {
  if (!loanId || !Number(amount)) {
    return { allocations: [], totals: { principal: 0, interest: 0, fees: 0, penalties: 0 } };
  }

  if (!LoanSchedule) {
    // If you don't maintain a schedule table, replace this with your logic
    return { allocations: [], totals: { principal: 0, interest: 0, fees: 0, penalties: 0 } };
  }

  const schedule = await LoanSchedule.findAll({
    where: { loanId },
    order: [['dueDate', 'ASC'], ['period', 'ASC']],
    raw: true,
  });

  if (!schedule.length) {
    return { allocations: [], totals: { principal: 0, interest: 0, fees: 0, penalties: 0 } };
  }

  const items = schedule.map(s => ({
    period: s.period,
    dueDate: s.dueDate,
    remaining: {
      principal: Math.max(0, Number(s.principal || 0) - Number(s.principalPaid || 0)),
      interest:  Math.max(0, Number(s.interest  || 0) - Number(s.interestPaid  || 0)),
      fees:      Math.max(0, Number(s.fees      || 0) - Number(s.feesPaid      || 0)),
      penalties: waivePenalties ? 0 : Math.max(0, Number(s.penalties || s.penalty || 0) - Number(s.penaltiesPaid || 0)),
    },
  }));

  let order;
  if (strategy === 'principal_first') order = ['principal', 'interest', 'fees', 'penalties'];
  else if (strategy === 'interest_first') order = ['interest', 'fees', 'penalties', 'principal'];
  else if (strategy === 'fees_first') order = ['fees', 'interest', 'penalties', 'principal'];
  else if (strategy === 'custom') order = String(customOrder || '').split(',').map(x => x.trim()).filter(Boolean);
  else order = ['penalties', 'interest', 'fees', 'principal']; // default: oldest_due_first

  if (waivePenalties) order = order.filter(x => x !== 'penalties');

  let left = Number(amount);
  const allocations = [];
  const totals = { principal: 0, interest: 0, fees: 0, penalties: 0 };

  for (const it of items) {
    if (left <= 0) break;
    const line = { period: it.period, principal: 0, interest: 0, fees: 0, penalties: 0 };

    for (const cat of order) {
      if (left <= 0) break;
      const need = Math.max(0, it.remaining[cat] || 0);
      if (!need) continue;
      const take = Math.min(need, left);
      line[cat] += take;
      totals[cat] += take;
      it.remaining[cat] -= take;
      left -= take;
    }

    if (line.principal || line.interest || line.fees || line.penalties) {
      allocations.push(line);
    }
  }

  return { allocations, totals };
}

/* ===========================
   GET /api/repayments
   query: q, loanId, borrowerId, dateFrom, dateTo, page=1, pageSize=20
=========================== */
exports.getAllRepayments = async (req, res) => {
  try {
    const {
      q = '',
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = req.query;

    const where = {};
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date[Op.gte] = dateFrom;
      if (dateTo) where.date[Op.lte] = dateTo;
    }

    const include = [
      {
        model: Loan,
        include: [{ model: Borrower, attributes: ['id', 'name', 'phone', 'email'] }],
        where: {},
      },
    ];
    if (loanId) include[0].where.id = loanId;
    if (borrowerId) include[0].where.borrowerId = borrowerId;

    if (q) {
      include[0].required = true;
      include[0].include[0].where = { name: { [Op.iLike]: `%${q}%` } }; // Postgres
    }

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const { rows, count } = await LoanRepayment.findAndCountAll({
      where,
      include,
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ items: rows, total: count });
  } catch (err) {
    console.error('Fetch repayments error:', err);
    res.status(500).json({ error: 'Failed to fetch repayments' });
  }
};

/* ===========================
   GET /api/repayments/borrower/:borrowerId
=========================== */
exports.getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const repayments = await LoanRepayment.findAll({
      include: {
        model: Loan,
        where: { borrowerId },
        include: [{ model: Borrower, attributes: ['id', 'name', 'phone', 'email'] }],
      },
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching borrower repayments' });
  }
};

/* ===========================
   GET /api/repayments/loan/:loanId
=========================== */
exports.getRepaymentsByLoan = async (req, res) => {
  try {
    const { loanId } = req.params;
    const repayments = await LoanRepayment.findAll({
      where: { loanId },
      include: [{ model: Loan, include: [{ model: Borrower, attributes: ['id', 'name', 'phone', 'email'] }] }],
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching loan repayments' });
  }
};

/* ===========================
   GET /api/repayments/:id (receipt view)
=========================== */
exports.getRepaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const repayment = await LoanRepayment.findByPk(id, {
      include: [{ model: Loan, include: [Borrower] }],
    });
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

    const allocation = repayment.allocation || []; // JSONB recommended
    return res.json(shapeReceipt(repayment, allocation));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching repayment' });
  }
};

/* ===========================
   POST /api/repayments/preview-allocation
   body: { loanId, amount, date, strategy, customOrder?, waivePenalties? }
=========================== */
exports.previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;
    const result = await computeAllocations({ loanId, amount, date, strategy, customOrder, waivePenalties });
    return res.json(result);
  } catch (err) {
    console.error('previewAllocation error:', err);
    res.status(500).json({ error: 'Preview allocation failed' });
  }
};

/* ===========================
   POST /api/repayments/manual
   body: { loanId, amount, date, method, reference?, notes?, strategy, customOrder?, waivePenalties?, issueReceipt? }
=========================== */
exports.createRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Adjust role check to your app
    const { role } = req.user || {};
    if (!role || !['Admin', 'LoanOfficer'].includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: 'Not permitted to create repayments' });
    }

    const {
      loanId,
      amount,
      date,
      method = 'cash',
      reference,
      notes,
      strategy = 'oldest_due_first',
      customOrder,
      waivePenalties = false,
      issueReceipt = true,
    } = req.body;

    if (!loanId || !Number(amount) || !date) {
      await t.rollback();
      return res.status(400).json({ error: 'loanId, amount and date are required' });
    }

    // Compute allocation
    const { allocations, totals } = await computeAllocations({
      loanId, amount, date, strategy, customOrder, waivePenalties
    });

    // Create repayment
    const repayment = await LoanRepayment.create({
      loanId,
      amount: Number(amount),
      date,
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations, // JSONB recommended
      currency: 'TZS', // or infer from loan
      postedBy: req.user?.id,
      postedByName: req.user?.name,
      postedByEmail: req.user?.email,
    }, { transaction: t });

    // Apply allocation to schedule (if present)
    if (LoanSchedule && allocations.length) {
      for (const line of allocations) {
        const row = await LoanSchedule.findOne(
          { where: { loanId, period: line.period } },
          { transaction: t }
        );
        if (!row) continue;

        const principalPaid = Number(row.principalPaid || 0) + Number(line.principal || 0);
        const interestPaid  = Number(row.interestPaid  || 0) + Number(line.interest  || 0);
        const feesPaid      = Number(row.feesPaid      || 0) + Number(line.fees      || 0);
        const penaltiesPaid = Number(row.penaltiesPaid || 0) + Number(line.penalties || 0);

        const total = Number(
          row.total ??
          (Number(row.principal||0) + Number(row.interest||0) + Number(row.fees||0) + Number(row.penalties||0))
        );
        const paid  = principalPaid + interestPaid + feesPaid + penaltiesPaid;

        const status =
          paid >= total - 0.01
            ? 'paid'
            : (new Date(row.dueDate) < new Date(date) ? 'overdue' : 'upcoming');

        await row.update(
          { principalPaid, interestPaid, feesPaid, penaltiesPaid, paid, status },
          { transaction: t }
        );
      }
    }

    await t.commit();

    // Load loan+borrower for the receipt shape (optional)
    const repFull = await LoanRepayment.findByPk(repayment.id, {
      include: [{ model: Loan, include: [{ model: Borrower, attributes: ['id', 'name'] }] }],
    });

    return res.status(201).json({
      repaymentId: repayment.id,
      receipt: issueReceipt ? shapeReceipt(repFull || repayment, allocations) : undefined,
      totals,
    });
  } catch (err) {
    await t.rollback();
    console.error('Create repayment error:', err);
    res.status(500).json({ error: 'Error saving repayment' });
  }
};

/* ===========================
   PUT /api/repayments/:id
=========================== */
exports.updateRepayment = async (req, res) => {
  try {
    const { id } = req.params;
    const repayment = await LoanRepayment.findByPk(id);
    if (!repayment) return res.status(404).json({ error: 'Not found' });

    const { role } = req.user || {};
    if (!role || !['Admin'].includes(role)) {
      return res.status(403).json({ error: 'Not permitted to update repayment' });
    }

    const updatable = ['date', 'amount', 'method', 'reference', 'notes'];
    const payload = {};
    for (const k of updatable) if (k in req.body) payload[k] = req.body[k];

    await repayment.update(payload);
    res.json(repayment);
  } catch (err) {
    console.error('Update repayment error:', err);
    res.status(500).json({ error: 'Failed to update repayment' });
  }
};

/* ===========================
   DELETE /api/repayments/:id
=========================== */
exports.deleteRepayment = async (req, res) => {
  try {
    const { id } = req.params;
    const repayment = await LoanRepayment.findByPk(id);
    if (!repayment) return res.status(404).json({ error: 'Not found' });

    const { role } = req.user || {};
    if (!role || !['Admin'].includes(role)) {
      return res.status(403).json({ error: 'Not permitted to delete repayment' });
    }

    await repayment.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete repayment error:', err);
    res.status(500).json({ error: 'Failed to delete repayment' });
  }
};

