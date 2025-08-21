// controllers/repaymentController.js
const { Op } = require("sequelize");
const {
  LoanRepayment,
  LoanPayment,
  Loan,
  Borrower,
  LoanSchedule,
  SavingsTransaction,
  Communication,
  sequelize,
} = require("../models");

const Repayment = LoanRepayment || LoanPayment;
const hasSavings = !!SavingsTransaction;

const Notifier = require('../services/notifier')({ Communication, Borrower });
const Gateway  = require('../services/paymentGateway')();

/* =============== util helpers (attr pickers) =============== */
function repaymentDateAttr() {
  const attrs = (Repayment && Repayment.rawAttributes) || {};
  if ("date" in attrs) return "date";
  if ("paymentDate" in attrs) return "paymentDate";
  if ("paidAt" in attrs) return "paidAt";
  return "createdAt";
}
function repaymentAmountAttr() {
  const attrs = (Repayment && Repayment.rawAttributes) || {};
  if ("amount" in attrs) return "amount";
  if ("amountPaid" in attrs) return "amountPaid";
  return null;
}
function getRepaymentDateValue(r) {
  return r.date || r.paymentDate || r.payment_date || r.paidAt || r.paid_at || r.createdAt || null;
}
function getRepaymentAmountValue(r) {
  return Number(r.amount != null ? r.amount : (r.amountPaid != null ? r.amountPaid : 0));
}

/* ========================= receipt shape ========================= */
const shapeReceipt = (repayment, allocation = []) => {
  const totals = allocation.reduce(
    (acc, a) => ({
      principal: acc.principal + Number(a.principal || 0),
      interest:  acc.interest  + Number(a.interest  || 0),
      fees:      acc.fees      + Number(a.fees      || 0),
      penalties: acc.penalties + Number(a.penalties || 0),
    }),
    { principal: 0, interest: 0, fees: 0, penalties: 0 }
  );

  const loan = repayment.Loan || {};
  const borrower = loan.Borrower || {};

  return {
    id: repayment.id,
    receiptNo: repayment.receiptNo || `RCPT-${repayment.id}`,
    date: getRepaymentDateValue(repayment),
    amount: getRepaymentAmountValue(repayment),
    currency: repayment.currency || loan.currency || "TZS",
    method: repayment.method || "cash",
    reference: repayment.reference || repayment.ref || null,
    notes: repayment.notes || null,
    loan: {
      id: loan.id,
      reference: loan.reference || `L-${loan.id}`,
      borrowerName: borrower?.name || "",
    },
    postedBy: repayment.postedBy
      ? {
          name:  repayment.postedByName  || "User",
          email: repayment.postedByEmail || "",
        }
      : null,
    allocation,
    totals,
  };
};

/* =========================== allocations =========================== */
async function computeAllocations({
  loanId,
  amount,
  date,
  strategy = "oldest_due_first",
  customOrder,
  waivePenalties = false,
}) {
  if (!loanId || !Number(amount) || !LoanSchedule) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const schedule = await LoanSchedule.findAll({
    where: { loanId },
    order: [["dueDate", "ASC"], ["period", "ASC"]],
    raw: true,
  });

  if (!schedule.length) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const items = schedule.map((s, idx) => {
    const principalDue = Math.max(0, Number(s.principal || 0) - Number(s.principalPaid || 0));
    const interestDue  = Math.max(0, Number(s.interest  || 0) - Number(s.interestPaid  || 0));
    const feesDue      = Math.max(0, Number(s.fees      || 0) - Number(s.feesPaid      || 0));
    const penDue       = Math.max(0, Number(s.penalties ?? s.penalty ?? 0) - Number(s.penaltiesPaid || 0));
    return {
      period: s.period ?? idx + 1,
      dueDate: s.dueDate,
      remaining: {
        principal: Number.isFinite(principalDue) ? principalDue : 0,
        interest:  Number.isFinite(interestDue)  ? interestDue  : 0,
        fees:      Number.isFinite(feesDue)      ? feesDue      : 0,
        penalties: waivePenalties ? 0 : (Number.isFinite(penDue) ? penDue : 0),
      },
    };
  });

  let order;
  if (strategy === "principal_first") order = ["principal", "interest", "fees", "penalties"];
  else if (strategy === "interest_first") order = ["interest", "fees", "penalties", "principal"];
  else if (strategy === "fees_first") order = ["fees", "interest", "penalties", "principal"];
  else if (strategy === "custom")
    order = String(customOrder || "").split(",").map(x => x.trim()).filter(Boolean);
  else order = ["penalties", "interest", "fees", "principal"];

  if (waivePenalties) order = order.filter((x) => x !== "penalties");

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
      line[cat]   += take;
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

async function applyAllocationToSchedule({ loanId, allocations, asOfDate, t, sign = +1 }) {
  if (!LoanSchedule || !allocations?.length) return;

  for (const line of allocations) {
    const row = await LoanSchedule.findOne({ where: { loanId, period: line.period }, transaction: t });
    if (!row) continue;

    const principalPaid = Number(row.principalPaid || 0) + sign * Number(line.principal || 0);
    const interestPaid  = Number(row.interestPaid  || 0) + sign * Number(line.interest  || 0);
    const feesPaid      = Number(row.feesPaid      || 0) + sign * Number(line.fees      || 0);
    const penaltiesPaid = Number(row.penaltiesPaid || 0) + sign * Number(line.penalties || 0);

    const total = Number(
      row.total != null
        ? row.total
        : (row.principal || 0) + (row.interest || 0) + (row.fees || 0) + (row.penalties || 0)
    );
    const paid = Math.max(0, principalPaid + interestPaid + feesPaid + penaltiesPaid);

    const status =
      paid >= total - 0.01
        ? "paid"
        : new Date(row.dueDate) < new Date(asOfDate || new Date())
        ? "overdue"
        : "upcoming";

    await row.update(
      {
        principalPaid: Math.max(0, principalPaid),
        interestPaid:  Math.max(0, interestPaid),
        feesPaid:      Math.max(0, feesPaid),
        penaltiesPaid: Math.max(0, penaltiesPaid),
        paid,
        status,
      },
      { transaction: t }
    );
  }
}

/* ==========================
   📥 LIST
========================== */
const getAllRepayments = async (req, res) => {
  try {
    const { q = "", loanId, borrowerId, dateFrom, dateTo, page = 1, pageSize = 20 } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;
    const dateAttr = repaymentDateAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const include = [{
      model: Loan,
      where: {},
      include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }],
    }];
    if (loanId) include[0].where.id = loanId;
    if (borrowerId) include[0].where.borrowerId = borrowerId;

    if (q && q.trim()) {
      include[0].required = true;
      const needle = `%${q.trim()}%`;
      include[0].include[0].where = { [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }] };
    }

    const { rows, count } = await Repayment.findAndCountAll({
      where,
      include,
      order: [[dateAttr, "DESC"], ["createdAt", "DESC"]],
      limit,
      offset,
    });

    const filtered = q && q.trim()
      ? rows.filter((r) => {
          const borrower = r.Loan?.Borrower || {};
          const hay = [
            borrower.name,
            borrower.phone,
            r.Loan?.reference,
            r.reference,
            r.method,
            r.receiptNo,
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q.trim().toLowerCase());
        })
      : rows;

    res.json({ items: filtered, total: q ? filtered.length : count });
  } catch (err) {
    console.error("Fetch repayments error:", err);
    res.status(500).json({ error: "Failed to fetch repayments" });
  }
};

/* ==========================
   🔍 BY BORROWER / LOAN
========================== */
const getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const dateAttr = repaymentDateAttr();

    const repayments = await Repayment.findAll({
      include: {
        model: Loan,
        where: { borrowerId },
        include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }],
      },
      order: [[dateAttr, "DESC"], ["createdAt", "DESC"]],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching borrower repayments" });
  }
};

const getRepaymentsByLoan = async (req, res) => {
  try {
    const loanId = req.params.loanId || req.params.id;
    if (!loanId) return res.status(400).json({ error: "loanId required" });
    const dateAttr = repaymentDateAttr();

    const repayments = await Repayment.findAll({
      where: { loanId },
      include: [{ model: Loan, include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }] }],
      order: [[dateAttr, "DESC"], ["createdAt", "DESC"]],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching loan repayments" });
  }
};

const getRepaymentById = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id, {
      include: [{ model: Loan, include: [Borrower] }],
    });
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const allocation = repayment.allocation || [];
    res.json(shapeReceipt(repayment, allocation));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching repayment" });
  }
};

/* ==========================
   🧮 PREVIEW
========================== */
const previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;
    const loan = await Loan.findByPk(loanId, { include: [Borrower] });
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const result = await computeAllocations({ loanId, amount, date, strategy, customOrder, waivePenalties });
    res.json({ ...result, loanCurrency: loan.currency || "TZS", borrowerName: loan.Borrower?.name || "" });
  } catch (err) {
    console.error("previewAllocation error:", err);
    res.status(500).json({ error: "Preview allocation failed" });
  }
};

/* ==========================
   💰 CREATE (manual, immediate post)
========================== */
const createRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const allowed = ["admin", "loanofficer", "loan_officer", "loan-officer"];
    if (!allowed.includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: "Not permitted to create repayments" });
    }

    const { loanId, amount, date, method = "cash", reference, notes, strategy, customOrder, waivePenalties = false, issueReceipt = true } = req.body;

    if (!loanId || !Number(amount) || !date) {
      await t.rollback();
      return res.status(400).json({ error: "loanId, amount and date are required" });
    }

    const loan = await Loan.findByPk(loanId, { include: [Borrower], transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    const { allocations, totals } = await computeAllocations({ loanId, amount, date, strategy, customOrder, waivePenalties });

    // Build payload flexibly (LoanPayment is default)
    const payload = {
      loanId,
      amountPaid: Number(amount),
      paymentDate: date,
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations,
      currency: loan.currency || "TZS",
      status: 'approved',
      applied: true,
      postedBy: req.user?.id,
      postedByName: req.user?.name,
      postedByEmail: req.user?.email,
    };

    // Keep only valid attributes
    const attrs = (Repayment && Repayment.rawAttributes) || {};
    for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

    const repayment = await Repayment.create(payload, { transaction: t });

    // Apply allocations + aggregates
    await applyAllocationToSchedule({ loanId, allocations, asOfDate: date, t, sign: +1 });

    const paidThis = getRepaymentAmountValue(payload);
    const loanTotalPaid = Number(loan.totalPaid || 0) + Number(paidThis || 0);
    const principal = Number(loan.amount || 0);
    const totalInterest = Number(loan.totalInterest || 0);
    const outstanding = Math.max(0, principal + totalInterest - loanTotalPaid);

    await loan.update({ totalPaid: loanTotalPaid, outstanding }, { transaction: t });

    // Optional: credit borrower savings (auto-deposit)
    if (hasSavings) {
      await SavingsTransaction.create({
        borrowerId: loan.borrowerId,
        amount: Number(amount),
        type: 'deposit',
        narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
        reference: payload.reference || `RCPT-${repayment.id}`,
        date: date,
      }, { transaction: t });
    }

    await t.commit();

    // Notify borrower
    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(amount),
      loanRef: loan.reference || loan.id,
      method,
    });

    const repFull = await Repayment.findByPk(repayment.id, { include: [{ model: Loan, include: [Borrower] }] });

    res.status(201).json({
      repaymentId: repayment.id,
      receipt: issueReceipt ? shapeReceipt(repFull || repayment, allocations) : undefined,
      totals,
    });
  } catch (err) {
    await t.rollback();
    console.error("Create repayment error:", err);
    res.status(500).json({ error: "Error saving repayment" });
  }
};

/* ==========================
   ✨ BULK JSON [{loanReference|loanId, amount, date, method, reference}]
   - creates PENDING not-applied rows (to be approved)
========================== */
const createBulkRepayments = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const allowed = ["admin", "loanofficer", "loan_officer", "loan-officer"];
    if (!allowed.includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: "Not permitted" });
    }

    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) {
      await t.rollback();
      return res.status(400).json({ error: "Provide an array of repayments" });
    }

    const created = [];

    for (const it of items) {
      const { loanId: inLoanId, loanReference, amount, date, method = 'cash', reference, notes } = it;
      let loan = null;

      if (inLoanId) loan = await Loan.findByPk(inLoanId, { transaction: t });
      if (!loan && loanReference) loan = await Loan.findOne({ where: { reference: loanReference }, transaction: t });
      if (!loan) throw new Error(`Loan not found for item with loanId=${inLoanId || 'N/A'} loanReference=${loanReference || 'N/A'}`);

      const payload = {
        loanId: loan.id,
        amountPaid: Number(amount),
        paymentDate: date,
        method,
        reference: reference || null,
        notes: notes || null,
        status: 'pending',
        applied: false,
        currency: loan.currency || 'TZS',
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const r = await Repayment.create(payload, { transaction: t });
      created.push(r.id);
    }

    await t.commit();
    res.status(201).json({ message: 'Bulk repayments queued for approval', ids: created });
  } catch (err) {
    await t.rollback();
    console.error('Bulk create error:', err);
    res.status(500).json({ error: err.message || 'Bulk creation failed' });
  }
};

/* ==========================
   📄 CSV UPLOAD (multipart/form-data, field "file")
   columns: loanReference,amount,date,method,reference,notes
   -> creates PENDING rows
========================== */
const parseCsvBuffer = async (buffer) => {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const row = {};
    header.forEach((h, idx) => (row[h] = cols[idx]));
    out.push(row);
  }
  return out;
};

const uploadRepaymentsCsv = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!req.file || !req.file.buffer) {
      await t.rollback();
      return res.status(400).json({ error: 'CSV file missing (field name "file")' });
    }
    const rows = await parseCsvBuffer(req.file.buffer);
    if (!rows.length) {
      await t.rollback();
      return res.status(400).json({ error: 'CSV is empty' });
    }

    const created = [];
    for (const r of rows) {
      const loanRef = r.loanReference || r.loan_ref || r.reference;
      const loan = await Loan.findOne({ where: { reference: loanRef }, transaction: t });
      if (!loan) throw new Error(`Loan not found for reference ${loanRef}`);

      const payload = {
        loanId: loan.id,
        amountPaid: Number(r.amount || 0),
        paymentDate: r.date,
        method: r.method || 'cash',
        reference: r.reference || null,
        notes: r.notes || null,
        status: 'pending',
        applied: false,
        currency: loan.currency || 'TZS',
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const rec = await Repayment.create(payload, { transaction: t });
      created.push(rec.id);
    }

    await t.commit();
    res.status(201).json({ message: 'CSV uploaded, repayments queued for approval', ids: created });
  } catch (err) {
    await t.rollback();
    console.error('CSV upload error:', err);
    res.status(500).json({ error: err.message || 'CSV upload failed' });
  }
};

/* ==========================
   ✅ APPROVALS
========================== */
const listPendingApprovals = async (req, res) => {
  try {
    const items = await Repayment.findAll({
      where: { status: 'pending' },
      include: [{ model: Loan, include: [Borrower] }],
      order: [['createdAt','ASC']],
    });
    res.json(items);
  } catch (err) {
    console.error('listPendingApprovals error:', err);
    res.status(500).json({ error: 'Failed to fetch pending approvals' });
  }
};

const approveRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const repayment = await Repayment.findByPk(req.params.id, { include: [{ model: Loan, include: [Borrower] }], transaction: t });
    if (!repayment) { await t.rollback(); return res.status(404).json({ error: 'Repayment not found' }); }
    if (repayment.status !== 'pending') { await t.rollback(); return res.status(400).json({ error: 'Repayment is not pending' }); }

    const loan = repayment.Loan;
    const date = getRepaymentDateValue(repayment) || new Date().toISOString().slice(0,10);
    const allocations = repayment.allocation || (await computeAllocations({ loanId: loan.id, amount: getRepaymentAmountValue(repayment), date })).allocations;

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: date, t, sign: +1 });
    const paidThis = getRepaymentAmountValue(repayment);
    const loanTotalPaid = Number(loan.totalPaid || 0) + Number(paidThis || 0);
    const principal = Number(loan.amount || 0);
    const totalInterest = Number(loan.totalInterest || 0);
    const outstanding = Math.max(0, principal + totalInterest - loanTotalPaid);

    await loan.update({ totalPaid: loanTotalPaid, outstanding }, { transaction: t });
    await repayment.update({ status: 'approved', applied: true, allocation: allocations }, { transaction: t });

    // Optional savings deposit
    if (hasSavings) {
      await SavingsTransaction.create({
        borrowerId: loan.borrowerId,
        amount: Number(paidThis),
        type: 'deposit',
        narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
        reference: repayment.reference || `RCPT-${repayment.id}`,
        date: date,
      }, { transaction: t });
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(paidThis),
      loanRef: loan.reference || loan.id,
      method: repayment.method || 'cash',
    });

    res.json({ message: 'Repayment approved' });
  } catch (err) {
    await t.rollback();
    console.error('approveRepayment error:', err);
    res.status(500).json({ error: 'Approve failed' });
  }
};

const rejectRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });
    if (repayment.status !== 'pending') return res.status(400).json({ error: 'Repayment is not pending' });

    await repayment.update({ status: 'rejected', applied: false });
    res.json({ message: 'Repayment rejected' });
  } catch (err) {
    console.error('rejectRepayment error:', err);
    res.status(500).json({ error: 'Reject failed' });
  }
};

/* ==========================
   🚫 VOID / REVERSE (applied rows)
========================== */
const voidRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const repayment = await Repayment.findByPk(req.params.id, { include: [{ model: Loan, include: [Borrower] }], transaction: t });
    if (!repayment) { await t.rollback(); return res.status(404).json({ error: "Repayment not found" }); }
    if (repayment.status === 'voided') { await t.rollback(); return res.status(400).json({ error: 'Already voided' }); }

    const loan = repayment.Loan;
    const date = getRepaymentDateValue(repayment) || new Date().toISOString();

    if (repayment.applied) {
      // reverse schedule & totals
      if (repayment.allocation?.length) {
        await applyAllocationToSchedule({ loanId: loan.id, allocations: repayment.allocation, asOfDate: date, t, sign: -1 });
      }
      const amt = getRepaymentAmountValue(repayment);
      const newTotalPaid = Math.max(0, Number(loan.totalPaid || 0) - Number(amt || 0));
      const principal = Number(loan.amount || 0);
      const totalInterest = Number(loan.totalInterest || 0);
      const outstanding = Math.max(0, principal + totalInterest - newTotalPaid);
      await loan.update({ totalPaid: newTotalPaid, outstanding }, { transaction: t });
    }

    await repayment.update({ status: 'voided', applied: false, voidReason: req.body?.voidReason || null }, { transaction: t });

    await t.commit();
    res.json({ message: "Repayment voided" });
  } catch (err) {
    await t.rollback();
    console.error("Void repayment error:", err);
    res.status(500).json({ error: "Error voiding repayment" });
  }
};

/* ==========================
   📊 REPORTS
========================== */
const getRepaymentsSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo, loanId, borrowerId } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr  = repaymentAmountAttr();
    if (!amtAttr) return res.json({ totalAmount: 0, totalCount: 0, byMethod: [] });

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }
    where.status = 'approved';

    const include = [{
      model: Loan,
      where: {},
      include: borrowerId ? [{ model: Borrower, where: { id: borrowerId } }] : [{ model: Borrower }],
    }];
    if (loanId) include[0].where.id = loanId;

    const totalAmount = await Repayment.sum(amtAttr, { where, include });
    const totalCount  = await Repayment.count({ where, include });

    const byMethodRows = await Repayment.findAll({
      where, include,
      attributes: [
        "method",
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
        [sequelize.fn("SUM", sequelize.col(amtAttr)), "amount"]
      ],
      group: ["method"],
      order: [[sequelize.literal("amount"), "DESC"]],
    });

    const byMethod = byMethodRows.map(r => ({
      method: r.method || "unknown",
      count: Number(r.get("count") || 0),
      amount: Number(r.get("amount") || 0),
    }));

    res.json({
      totalAmount: Number(totalAmount || 0),
      totalCount: Number(totalCount || 0),
      byMethod,
    });
  } catch (err) {
    console.error("Repayments summary error:", err);
    res.status(500).json({ error: "Failed to build summary" });
  }
};

const getRepaymentsTimeSeries = async (req, res) => {
  try {
    const { dateFrom, dateTo, granularity = 'day' } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr  = repaymentAmountAttr();
    if (!amtAttr) return res.json({ series: [] });

    const where = { status: 'approved' };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    // Postgres date_trunc
    const bucket = sequelize.literal(`date_trunc('${granularity}', "${Repayment.name}"."${dateAttr}")`);
    const rows = await Repayment.findAll({
      where,
      attributes: [[bucket, 'bucket'], [sequelize.fn('SUM', sequelize.col(amtAttr)), 'amount']],
      group: ['bucket'],
      order: [[sequelize.literal('bucket'), 'ASC']],
    });

    const series = rows.map(r => ({
      date: r.get('bucket'),
      amount: Number(r.get('amount') || 0),
    }));
    res.json({ series });
  } catch (err) {
    console.error('TimeSeries error:', err);
    res.status(500).json({ error: 'Failed to build time series' });
  }
};

/* ==========================
   📤 EXPORT CSV
========================== */
const exportRepaymentsCsv = async (req, res) => {
  try {
    const { q = "", loanId, borrowerId, dateFrom, dateTo } = req.query;
    const dateAttr = repaymentDateAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const include = [{
      model: Loan,
      where: {},
      include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }],
    }];
    if (loanId) include[0].where.id = loanId;
    if (borrowerId) include[0].where.borrowerId = borrowerId;

    if (q && q.trim()) {
      include[0].required = true;
      const needle = `%${q.trim()}%`;
      include[0].include[0].where = { [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }] };
    }

    const rows = await Repayment.findAll({ where, include, order: [[dateAttr, "DESC"], ["createdAt", "DESC"]] });

    const headers = ["ReceiptNo","Date","Amount","Currency","Method","Reference","Borrower","LoanRef","LoanId","Status"];
    const csvLines = [headers.join(",")];
    for (const r of rows) {
      const loan = r.Loan || {};
      const br = loan.Borrower || {};
      const line = [
        `"${(r.receiptNo || `RCPT-${r.id}`).replace(/"/g, '""')}"`,
        `"${(getRepaymentDateValue(r) || "").toString().slice(0, 10)}"`,
        `${getRepaymentAmountValue(r)}`,
        `"${(r.currency || loan.currency || "TZS").replace(/"/g, '""')}"`,
        `"${(r.method || "").replace(/"/g, '""')}"`,
        `"${(r.reference || "").replace(/"/g, '""')}"`,
        `"${(br.name || "").replace(/"/g, '""')}"`,
        `"${(loan.reference || "").replace(/"/g, '""')}"`,
        `${loan.id || ""}`,
        `"${r.status || ''}"`,
      ];
      csvLines.push(line.join(","));
    }
    const csv = csvLines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="repayments.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("Export repayments error:", err);
    res.status(500).json({ error: "Failed to export repayments" });
  }
};

/* ==========================
   🔔 WEBHOOKS (mobile & bank)
   Expect body to include a loanReference in provider-specific fields
========================== */
const webhookMobileMoney = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature('mobile', req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const n = Gateway.normalizeWebhook('mobile', req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: 'Missing loan reference or amount' });
    }

    const loan = await Loan.findOne({ where: { reference: n.loanReference }, include: [Borrower], transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    // compute allocation and approve immediately
    const { allocations } = await computeAllocations({ loanId: loan.id, amount: n.amount, date: n.paidAt });

    const repayment = await Repayment.create({
      loanId: loan.id,
      amountPaid: Number(n.amount),
      paymentDate: n.paidAt?.slice(0,10),
      method: 'mobile',
      status: 'approved',
      applied: true,
      currency: n.currency || loan.currency || 'TZS',
      gateway: n.gateway || 'mobile',
      gatewayRef: n.gatewayRef || null,
      reference: `MM-${n.gatewayRef || Date.now()}`,
      allocation: allocations,
    }, { transaction: t });

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });

    const newTotalPaid = Number(loan.totalPaid || 0) + Number(n.amount);
    const outstanding = Math.max(0, Number(loan.amount || 0) + Number(loan.totalInterest || 0) - newTotalPaid);
    await loan.update({ totalPaid: newTotalPaid, outstanding }, { transaction: t });

    if (hasSavings) {
      await SavingsTransaction.create({
        borrowerId: loan.borrowerId,
        amount: Number(n.amount),
        type: 'deposit',
        narrative: `Loan repayment deposit (mobile) for ${loan.reference}`,
        reference: repayment.reference,
        date: n.paidAt?.slice(0,10),
      }, { transaction: t });
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: 'mobile',
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('Mobile webhook error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
};

const webhookBank = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature('bank', req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const n = Gateway.normalizeWebhook('bank', req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: 'Missing loan reference or amount' });
    }

    const loan = await Loan.findOne({ where: { reference: n.loanReference }, include: [Borrower], transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: 'Loan not found' });
    }

    const { allocations } = await computeAllocations({ loanId: loan.id, amount: n.amount, date: n.paidAt });

    const repayment = await Repayment.create({
      loanId: loan.id,
      amountPaid: Number(n.amount),
      paymentDate: n.paidAt?.slice(0,10),
      method: 'bank',
      status: 'approved',
      applied: true,
      currency: n.currency || loan.currency || 'TZS',
      gateway: 'bank',
      gatewayRef: n.gatewayRef || null,
      reference: `BK-${n.gatewayRef || Date.now()}`,
      allocation: allocations,
    }, { transaction: t });

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });

    const newTotalPaid = Number(loan.totalPaid || 0) + Number(n.amount);
    const outstanding = Math.max(0, Number(loan.amount || 0) + Number(loan.totalInterest || 0) - newTotalPaid);
    await loan.update({ totalPaid: newTotalPaid, outstanding }, { transaction: t });

    if (hasSavings) {
      await SavingsTransaction.create({
        borrowerId: loan.borrowerId,
        amount: Number(n.amount),
        type: 'deposit',
        narrative: `Loan repayment deposit (bank) for ${loan.reference}`,
        reference: repayment.reference,
        date: n.paidAt?.slice(0,10),
      }, { transaction: t });
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: 'bank',
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('Bank webhook error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
};

/* ==========================
   ✏️ UPDATE & DELETE (compat)
========================== */
const updateRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const body = { ...req.body };
    const attrs = (Repayment && Repayment.rawAttributes) || {};
    if (body.date && !("date" in attrs)) delete body.date;
    if (body.paymentDate && !("paymentDate" in attrs)) delete body.paymentDate;
    if (body.paidAt && !("paidAt" in attrs)) delete body.paidAt;

    await repayment.update(body);
    res.json(repayment);
  } catch (err) {
    console.error("Update repayment error:", err);
    res.status(500).json({ error: "Error updating repayment" });
  }
};

const deleteRepayment = async (req, res) => {
  // keep old route working but use the safe void path
  return voidRepayment(req, res);
};

/* ==========================
   EXPORTS
========================== */
module.exports = {
  // core
  getAllRepayments,
  getRepaymentsByBorrower,
  getRepaymentsByLoan,
  getRepaymentById,
  previewAllocation,
  createRepayment,
  updateRepayment,
  deleteRepayment,
  // bulk & csv
  createBulkRepayments,
  uploadRepaymentsCsv,
  // approvals
  listPendingApprovals,
  approveRepayment,
  rejectRepayment,
  // void
  voidRepayment,
  // reports
  getRepaymentsSummary,
  getRepaymentsTimeSeries,
  exportRepaymentsCsv,
  // webhooks
  webhookMobileMoney,
  webhookBank,
};
