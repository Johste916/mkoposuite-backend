// controllers/repaymentController.js
const { Op } = require("sequelize");
const {
  LoanRepayment,
  LoanPayment,          // ✅ also import LoanPayment
  Loan,
  Borrower,
  LoanSchedule,
  sequelize,
} = require("../models");

/* Pick the repayment model that exists in your app */
const Repayment = LoanRepayment || LoanPayment;

/* ============================================================
   Helpers: detect repayment date attribute + safe value accessor
============================================================ */
function repaymentDateAttr() {
  const attrs = (Repayment && Repayment.rawAttributes) || {};
  if ("date" in attrs) return "date";
  if ("paymentDate" in attrs) return "paymentDate";
  if ("paidAt" in attrs) return "paidAt";
  return "createdAt"; // final fallback (always exists)
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
    amount: Number(repayment.amount ?? repayment.amountPaid ?? 0),
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

  // category order
  let order;
  if (strategy === "principal_first") order = ["principal", "interest", "fees", "penalties"];
  else if (strategy === "interest_first") order = ["interest", "fees", "penalties", "principal"];
  else if (strategy === "fees_first") order = ["fees", "interest", "penalties", "principal"];
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

    const dateAttr = repaymentDateAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;           // ✅ uses model attribute name, not column name
    }

    const include = [
      {
        model: Loan,
        where: {},
        include: [{ model: Borrower, attributes: ["id", "name", "phone", "email"] }],
      },
    ];
    if (loanId) include[0].where.id = loanId;
    if (borrowerId) include[0].where.borrowerId = borrowerId;

    // basic borrower/phone search (server side)
    if (q && q.trim()) {
      include[0].required = true;
      const needle = `%${q.trim()}%`;
      include[0].include[0].where = {
        [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }],
      };
    }

    const { rows, count } = await Repayment.findAndCountAll({
      where,
      include,
      order: [[dateAttr, "DESC"], ["createdAt", "DESC"]],
      limit,
      offset,
    });

    // extra client filter against repayment reference/method etc.
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

/* ==========================
   📜 RECEIPT VIEW
========================== */
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

    // Flexible payload (covers both LoanRepayment and LoanPayment models)
    const payload = {
      loanId,
      amount: Number(amount),
      amountPaid: Number(amount), // for LoanPayment model
      date,                       // if model has 'date'
      paymentDate: date,          // if model has 'paymentDate'
      paidAt: date,               // if model has 'paidAt'
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations,
      currency: loan.currency || "TZS",
      postedBy: req.user?.id,
      postedByName: req.user?.name,
      postedByEmail: req.user?.email,
    };

    // Keep only keys that truly exist on the model
    const attrs = (Repayment && Repayment.rawAttributes) || {};
    for (const k of Object.keys(payload)) {
      if (!(k in attrs)) {
        // allow amount/amountPaid duality: keep at least one
        if (k === "amount" && "amountPaid" in attrs) continue;
        if (k === "amountPaid" && "amount" in attrs) continue;
        delete payload[k];
      }
    }

    const repayment = await Repayment.create(payload, { transaction: t });

    // Apply allocations to schedule (if present)
    if (LoanSchedule && allocations.length) {
      for (const line of allocations) {
        const row = await LoanSchedule.findOne({ where: { loanId, period: line.period }, transaction: t });
        if (!row) continue;

        const principalPaid = Number(row.principalPaid || 0) + Number(line.principal || 0);
        const interestPaid  = Number(row.interestPaid  || 0) + Number(line.interest  || 0);
        const feesPaid      = Number(row.feesPaid      || 0) + Number(line.fees      || 0);
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

    // Update loan aggregates
    const loanTotalPaid = Number(loan.totalPaid || 0) + Number(amount);
    const loanTotalInterest = Number(loan.totalInterest || 0);
    const principal = Number(loan.amount || loan.principal || 0);

    const outstanding = Math.max(0, principal + loanTotalInterest - loanTotalPaid);
    const newStatus = outstanding <= 0 ? "closed" : loan.status;

    await loan.update({ totalPaid: loanTotalPaid, outstanding, status: newStatus }, { transaction: t });

    await t.commit();

    const repFull = await Repayment.findByPk(repayment.id, {
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
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const body = { ...req.body };
    // keep date flexibility on update too
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

/* ==========================
   🗑️ DELETE REPAYMENT
========================== */
const deleteRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
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
