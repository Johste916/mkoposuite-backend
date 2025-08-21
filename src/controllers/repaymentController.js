// controllers/repaymentController.js
const { Op } = require("sequelize");
const {
  LoanRepayment,
  Loan,
  Borrower,
  LoanSchedule,
  sequelize,
} = require("../models");

/* ============================================================
   Helpers: detect repayment date field + safe value accessor
============================================================ */
let REPAYMENT_COL_CACHE = null;

function getRepaymentsTableName() {
  const t = LoanRepayment.getTableName ? LoanRepayment.getTableName() : "loan_repayments";
  return typeof t === "string" ? t : t.tableName || "loan_repayments";
}

async function getRepaymentColumns() {
  if (REPAYMENT_COL_CACHE) return REPAYMENT_COL_CACHE;
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable(getRepaymentsTableName());
    REPAYMENT_COL_CACHE = new Set(Object.keys(desc));
  } catch {
    // fallback: infer from model attributes (may be less accurate)
    REPAYMENT_COL_CACHE = new Set(
      Object.values(LoanRepayment.rawAttributes || {}).map(
        (a) => a.field || a.fieldName || a
      )
    );
  }
  return REPAYMENT_COL_CACHE;
}

/** Choose the column to use in WHERE/ORDER for dates. */
async function repaymentDateField() {
  const cols = await getRepaymentColumns();
  if (cols.has("date")) return "date";
  if (cols.has("payment_date")) return "payment_date";
  if (cols.has("paid_at")) return "paid_at";
  return "createdAt"; // final fallback
}

/** Get a JS date-ish value from an instance for display */
function getRepaymentDateValue(r) {
  return (
    r.date ||
    r.paymentDate ||
    r.payment_date ||
    r.paidAt ||
    r.paid_at ||
    r.createdAt ||
    null
  );
}

/* ==========================
   📌 Helper: Shape Receipt
========================== */
const shapeReceipt = (repayment, allocation = []) => {
  const totals = allocation.reduce(
    (acc, a) => ({
      principal: acc.principal + Number(a.principal || 0),
      interest: acc.interest + Number(a.interest || 0),
      fees: acc.fees + Number(a.fees || 0),
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
    amount: Number(repayment.amount || 0),
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
          name: repayment.postedByName || "User",
          email: repayment.postedByEmail || "",
        }
      : null,
    allocation,
    totals,
  };
};

/* =================================
   📌 Helper: Compute Allocations
================================= */
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
    const principalDue = Math.max(
      0,
      Number(s.principal || 0) - Number(s.principalPaid || 0)
    );
    const interestDue = Math.max(
      0,
      Number(s.interest || 0) - Number(s.interestPaid || 0)
    );
    const feesDue = Math.max(0, Number(s.fees || 0) - Number(s.feesPaid || 0));
    const penDue = Math.max(
      0,
      Number(s.penalties ?? s.penalty ?? 0) - Number(s.penaltiesPaid || 0)
    );

    return {
      period: s.period ?? idx + 1,
      dueDate: s.dueDate,
      remaining: {
        principal: isFinite(principalDue) ? principalDue : 0,
        interest: isFinite(interestDue) ? interestDue : 0,
        fees: isFinite(feesDue) ? feesDue : 0,
        penalties: waivePenalties ? 0 : isFinite(penDue) ? penDue : 0,
      },
    };
  });

  // category order
  let order;
  if (strategy === "principal_first")
    order = ["principal", "interest", "fees", "penalties"];
  else if (strategy === "interest_first")
    order = ["interest", "fees", "penalties", "principal"];
  else if (strategy === "fees_first")
    order = ["fees", "interest", "penalties", "principal"];
  else if (strategy === "custom")
    order = String(customOrder || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
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

/* ==========================
   📥 LIST REPAYMENTS
========================== */
const getAllRepayments = async (req, res) => {
  try {
    const {
      q = "",
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const dateField = await repaymentDateField();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateField] = and;
    }

    const include = [
      {
        model: Loan,
        where: {},
        include: [
          { model: Borrower, attributes: ["id", "name", "phone", "email"] },
        ],
      },
    ];
    if (loanId) include[0].where.id = loanId;
    if (borrowerId) include[0].where.borrowerId = borrowerId;

    // text search across borrower name/phone, loan reference, repayment reference/method
    if (q && q.trim()) {
      include[0].required = true;
      const needle = `%${q.trim()}%`;
      include[0].include[0].where = {
        [Op.or]: [
          { name: { [Op.iLike]: needle } },
          { phone: { [Op.iLike]: needle } },
        ],
      };
    }

    const { rows, count } = await LoanRepayment.findAndCountAll({
      where,
      include,
      order: [[dateField, "DESC"], ["createdAt", "DESC"]],
      limit,
      offset,
    });

    // If q provided, also match repayment.reference/method on the app side
    const filtered =
      q && q.trim()
        ? rows.filter((r) => {
            const borrower = r.Loan?.Borrower || {};
            const hay = [
              borrower.name,
              borrower.phone,
              r.Loan?.reference,
              r.reference,
              r.method,
              r.receiptNo,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return hay.includes(q.trim().toLowerCase());
          })
        : rows;

    res.json({ items: filtered, total: q ? filtered.length : count });
  } catch (err) {
    console.error("Fetch repayments error:", err);
    res.status(500).json({ error: "Failed to fetch repayments" });
  }
};

/* ==============================================
   📌 GET REPAYMENTS BY BORROWER / LOAN
============================================== */
const getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const dateField = await repaymentDateField();

    const repayments = await LoanRepayment.findAll({
      include: {
        model: Loan,
        where: { borrowerId },
        include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }],
      },
      order: [[dateField, "DESC"], ["createdAt", "DESC"]],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching borrower repayments" });
  }
};

const getRepaymentsByLoan = async (req, res) => {
  try {
    const loanId = req.params.loanId || req.params.id; // accept either
    if (!loanId) return res.status(400).json({ error: "loanId required" });
    const dateField = await repaymentDateField();

    const repayments = await LoanRepayment.findAll({
      where: { loanId },
      include: [{ model: Loan, include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }] }],
      order: [[dateField, "DESC"], ["createdAt", "DESC"]],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching loan repayments" });
  }
};

/* ==========================
   📜 RECEIPT VIEW
========================== */
const getRepaymentById = async (req, res) => {
  try {
    const repayment = await LoanRepayment.findByPk(req.params.id, {
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
   🧮 PREVIEW ALLOCATION
========================== */
const previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;
    const loan = await Loan.findByPk(loanId, { include: [Borrower] });
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const result = await computeAllocations({
      loanId,
      amount,
      date,
      strategy,
      customOrder,
      waivePenalties,
    });

    res.json({
      ...result,
      loanCurrency: loan.currency || "TZS",
      borrowerName: loan.Borrower?.name || "",
    });
  } catch (err) {
    console.error("previewAllocation error:", err);
    res.status(500).json({ error: "Preview allocation failed" });
  }
};

/* ==========================
   💰 CREATE REPAYMENT
========================== */
const createRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // robust role check
    const role = String(req.user?.role || "").toLowerCase();
    const allowed = ["admin", "loanofficer", "loan_officer", "loan-officer"];
    if (!allowed.includes(role)) {
      await t.rollback();
      return res.status(403).json({ error: "Not permitted to create repayments" });
    }

    const {
      loanId,
      amount,
      date,
      method = "cash",
      reference,
      notes,
      strategy,
      customOrder,
      waivePenalties = false,
      issueReceipt = true,
    } = req.body;

    if (!loanId || !Number(amount) || !date) {
      await t.rollback();
      return res.status(400).json({ error: "loanId, amount and date are required" });
    }

    const loan = await Loan.findByPk(loanId, { transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    const { allocations, totals } = await computeAllocations({
      loanId,
      amount,
      date,
      strategy,
      customOrder,
      waivePenalties,
    });

    // be flexible with repayment attribute names (model might map date->payment_date)
    const payload = {
      loanId,
      amount: Number(amount),
      date,               // model attr 'date' (maps to 'payment_date' if configured)
      paymentDate: date,  // in case the model uses 'paymentDate'
      paidAt: date,       // last-ditch alternative
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations,
      currency: loan.currency || "TZS",
      postedBy: req.user?.id,
      postedByName: req.user?.name,
      postedByEmail: req.user?.email,
    };

    // strip keys that aren't model attributes (Sequelize ignores unknown keys usually,
    // but this keeps payload tidy if strict mode is enabled)
    const attrs = LoanRepayment.rawAttributes || {};
    for (const k of ["date", "paymentDate", "paidAt"]) {
      if (!(k in attrs)) delete payload[k];
    }

    const repayment = await LoanRepayment.create(payload, { transaction: t });

    // Apply allocations to schedule (if present)
    if (LoanSchedule && allocations.length) {
      for (const line of allocations) {
        const row = await LoanSchedule.findOne({
          where: { loanId, period: line.period },
          transaction: t,
        });
        if (!row) continue;

        const principalPaid = Number(row.principalPaid || 0) + Number(line.principal || 0);
        const interestPaid = Number(row.interestPaid || 0) + Number(line.interest || 0);
        const feesPaid = Number(row.feesPaid || 0) + Number(line.fees || 0);
        const penaltiesPaid = Number(row.penaltiesPaid || 0) + Number(line.penalties || 0);

        const total =
          Number(row.total != null
            ? row.total
            : (row.principal || 0) + (row.interest || 0) + (row.fees || 0) + (row.penalties || 0));
        const paid = principalPaid + interestPaid + feesPaid + penaltiesPaid;

        const status =
          paid >= total - 0.01
            ? "paid"
            : new Date(row.dueDate) < new Date(date)
            ? "overdue"
            : "upcoming";

        await row.update(
          { principalPaid, interestPaid, feesPaid, penaltiesPaid, paid, status },
          { transaction: t }
        );
      }
    }

    // Update loan aggregates (best-effort; adjust if your schema differs)
    const loanTotalPaid = Number(loan.totalPaid || 0) + Number(amount);
    const loanTotalInterest = Number(loan.totalInterest || 0);
    const principal = Number(loan.amount || loan.principal || 0);

    const outstanding = Math.max(0, principal + loanTotalInterest - loanTotalPaid);
    const newStatus = outstanding <= 0 ? "closed" : loan.status;

    await loan.update(
      { totalPaid: loanTotalPaid, outstanding, status: newStatus },
      { transaction: t }
    );

    await t.commit();

    const repFull = await LoanRepayment.findByPk(repayment.id, {
      include: [{ model: Loan, include: [Borrower] }],
    });

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
   ✏️ UPDATE REPAYMENT
========================== */
const updateRepayment = async (req, res) => {
  try {
    const repayment = await LoanRepayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const body = { ...req.body };
    // keep date flexibility on update too
    const attrs = LoanRepayment.rawAttributes || {};
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

/* ==========================
   🗑️ DELETE REPAYMENT
========================== */
const deleteRepayment = async (req, res) => {
  try {
    const repayment = await LoanRepayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    await repayment.destroy();
    res.json({ message: "Repayment deleted" });
  } catch (err) {
    console.error("Delete repayment error:", err);
    res.status(500).json({ error: "Error deleting repayment" });
  }
};

/* ==========================
   EXPORTS
========================== */
module.exports = {
  getAllRepayments,
  getRepaymentsByBorrower,
  getRepaymentsByLoan,
  getRepaymentById,
  previewAllocation,
  createRepayment,
  updateRepayment,
  deleteRepayment,
};
