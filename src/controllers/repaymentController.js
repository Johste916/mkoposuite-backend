// controllers/repayments.js
const fs = require("fs");
const { Op, fn, col, literal } = require("sequelize");
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

const Notifier = require("../services/notifier")({ Communication, Borrower });
const Gateway = require("../services/paymentGateway")();

/* ------------------------------------------------------------
   Permission helper (permission-first, role-fallback)
   ------------------------------------------------------------ */
function hasPermission(req, action, fallbackRoles = []) {
  const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : null;
  if (perms && perms.length) {
    return perms.includes(action);
  }
  // Fallback to roles until you fully roll out permissions
  const allow = fallbackRoles.map((r) => String(r).toLowerCase());
  const primary = String(req.user?.role || "").toLowerCase();
  const all = Array.isArray(req.user?.roles)
    ? req.user.roles.map((r) => String(r).toLowerCase())
    : [];
  return allow.length === 0 || allow.includes(primary) || all.some((r) => allow.includes(r));
}

/* ============================================================
   SCHEMA PROBE + SAFE ATTRIBUTE PICKERS
   ============================================================ */
let _loanTableColumns = null;   // { [colName]: true }
let _repayTableColumns = null;  // { [colName]: true }

async function describeTableSafe(names = []) {
  const qi = sequelize.getQueryInterface();
  for (const name of names) {
    try {
      const desc = await qi.describeTable(name);
      if (desc) return Object.fromEntries(Object.keys(desc).map((k) => [k, true]));
    } catch {}
  }
  return {};
}

async function getLoanTableColumns() {
  if (_loanTableColumns) return _loanTableColumns;
  try {
    _loanTableColumns = await describeTableSafe(["loans", "Loans"]);
  } catch {
    _loanTableColumns = {};
  }
  return _loanTableColumns;
}

async function getRepaymentTableColumns() {
  if (_repayTableColumns) return _repayTableColumns;
  try {
    _repayTableColumns = await describeTableSafe([
      "loan_repayments",
      "LoanRepayments",
      "loan_payments",
      "LoanPayments",
    ]);
  } catch {
    _repayTableColumns = {};
  }
  return _repayTableColumns;
}

function mapLoanAttrToField(attrName) {
  const ra = Loan?.rawAttributes || {};
  const def = ra[attrName];
  if (!def) return null;
  return def.field || attrName;
}

function mapRepaymentAttrToField(attrName) {
  const ra = Repayment?.rawAttributes || {};
  const def = ra[attrName];
  if (!def) return null;
  return def.field || attrName;
}

async function pickExistingLoanAttributes(attrNames = []) {
  const cols = await getLoanTableColumns();
  const selected = [];
  for (const name of attrNames) {
    const field = mapLoanAttrToField(name);
    if (!field) continue;
    if (cols[field]) selected.push(name);
  }
  if (selected.length && !selected.includes("id") && cols["id"]) selected.push("id");
  return selected.length ? selected : undefined;
}

async function repaymentHasColumn(attrName) {
  const cols = await getRepaymentTableColumns();
  const field = mapRepaymentAttrToField(attrName);
  return !!(field && cols[field]);
}

const BORROWER_ATTRS = ["id", "name", "phone", "email"];

// Default minimal attributes safe across schema variations
const LOAN_BASE_ATTRS = ["id", "borrowerId", "currency", "reference"];
// When we need to compute balances
const LOAN_AMOUNT_ATTRS = [
  ...LOAN_BASE_ATTRS,
  "amount",
  "totalInterest",
  "outstanding",
  "totalPaid",
  "status",
];

async function loanInclude({ where = {}, borrowerWhere, needAmounts = false } = {}) {
  const attrsWanted = needAmounts ? LOAN_AMOUNT_ATTRS : LOAN_BASE_ATTRS;
  const safeAttrs = await pickExistingLoanAttributes(attrsWanted);

  const borrowerInclude = {
    model: Borrower,
    attributes: BORROWER_ATTRS,
    ...(borrowerWhere ? { where: borrowerWhere } : {}),
  };

  return {
    model: Loan,
    ...(safeAttrs ? { attributes: safeAttrs } : {}),
    where,
    include: [borrowerInclude],
  };
}

async function loanRefSupported() {
  const cols = await getLoanTableColumns();
  return !!cols["reference"];
}

/* =================== util helpers (attr pickers) =================== */
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
function getRepaymentAmountValue(r) {
  return Number(
    r.amount != null ? r.amount : r.amountPaid != null ? r.amountPaid : 0
  );
}

/* ===== numeric helpers (no external deps) ===== */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const max0 = (v) => Math.max(0, Number(v) || 0);

/* ===== Safely update loan totals & status (auto-active / auto-closed) ===== */
async function updateLoanFinancials(loan, deltaPaid, t) {
  // deltaPaid: +amount when approving/applying; -amount when voiding/reversing
  const cols = await getLoanTableColumns();
  const updates = {};

  const totalPaidPrev = Number(loan.totalPaid || 0);
  const totalPaidField = mapLoanAttrToField("totalPaid");
  if (totalPaidField && cols[totalPaidField]) {
    updates.totalPaid = max0(round2(totalPaidPrev + Number(deltaPaid || 0)));
  }

  const outstandingField = mapLoanAttrToField("outstanding");
  let newOutstanding = loan.outstanding != null ? Number(loan.outstanding) : null;

  if (outstandingField && cols[outstandingField]) {
    if (newOutstanding != null) {
      newOutstanding = max0(round2(newOutstanding - Number(deltaPaid || 0)));
      updates.outstanding = newOutstanding;
    } else {
      const principal = Number(loan.amount || 0);
      const totalInterest = Number(loan.totalInterest || 0);
      const newTotalPaid =
        updates.totalPaid != null
          ? updates.totalPaid
          : max0(round2(totalPaidPrev + Number(deltaPaid || 0)));
      newOutstanding = max0(round2(principal + totalInterest - newTotalPaid));
      updates.outstanding = newOutstanding;
    }
  }

  // Auto status transitions if column exists:
  const statusField = mapLoanAttrToField("status");
  if (statusField && cols[statusField]) {
    const curr = String(loan.status || "").toLowerCase();
    // Close when fully paid
    if (newOutstanding === 0 && curr !== "closed") {
      updates.status = "closed";
    } else if (deltaPaid > 0 && totalPaidPrev === 0) {
      // First payment -> mark active if not already active/closed/rejected
      if (!["active", "closed", "rejected"].includes(curr)) {
        updates.status = "active";
      }
    }
  }

  if (Object.keys(updates).length) {
    await loan.update(updates, { transaction: t });
  }
}

/* ========================= receipt shape ========================= */
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
          name: repayment.postedByName || "User",
          email: repayment.postedByEmail || "",
        }
      : null,
    allocation,
    totals,
  };
};

/* =========================== allocations =========================== */
function remainingFromRow(row) {
  const principal = max0((row.principal ?? 0) - (row.principalPaid ?? 0));
  const interest = max0((row.interest ?? 0) - (row.interestPaid ?? 0));
  const fees = max0((row.fees ?? 0) - (row.feesPaid ?? 0));
  const penalties = max0(
    (row.penalties ?? row.penalty ?? 0) - (row.penaltiesPaid ?? 0)
  );

  // total/paid guard (some schemas rely on total/paid more than parts)
  const total = Number(
    row.total ??
      (row.principal || 0) +
        (row.interest || 0) +
        (row.fees || 0) +
        (row.penalties || row.penalty || 0)
  );
  const paid = Number(
    row.paid ??
      (row.principalPaid || 0) +
        (row.interestPaid || 0) +
        (row.feesPaid || 0) +
        (row.penaltiesPaid || 0)
  );
  const totalLeft = max0(total - paid);

  const sumParts = principal + interest + fees + penalties;
  if (totalLeft > 0 && sumParts === 0) {
    // Heuristic fallback: attribute remaining first to interest then principal
    const guessInterest = Math.min(totalLeft, Number(row.interest || 0));
    const guessPrincipal = max0(totalLeft - guessInterest);
    return {
      principal: guessPrincipal,
      interest: guessInterest,
      fees: 0,
      penalties: 0,
      totalLeft,
    };
  }
  // Also never let parts sum exceed totalLeft
  if (sumParts > totalLeft + 0.0001) {
    const ratio = totalLeft / sumParts;
    return {
      principal: round2(principal * ratio),
      interest: round2(interest * ratio),
      fees: round2(fees * ratio),
      penalties: round2(penalties * ratio),
      totalLeft,
    };
  }

  return { principal, interest, fees, penalties, totalLeft };
}

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
    order: [
      ["dueDate", "ASC"],
      ["period", "ASC"],
    ],
    raw: true,
  });

  if (!schedule.length) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const items = schedule.map((s, idx) => {
    const rem = remainingFromRow(s);
    return {
      id: s.id,
      period: s.period ?? idx + 1,
      dueDate: s.dueDate,
      remaining: {
        principal: rem.principal,
        interest: rem.interest,
        fees: rem.fees,
        penalties: waivePenalties ? 0 : rem.penalties,
      },
    };
  });

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

  let left = round2(Number(amount));
  const allocations = [];
  const totals = { principal: 0, interest: 0, fees: 0, penalties: 0 };

  for (const it of items) {
    if (left <= 0) break;
    const line = { period: it.period, principal: 0, interest: 0, fees: 0, penalties: 0 };

    for (const cat of order) {
      if (left <= 0) break;
      const need = max0(it.remaining[cat] || 0);
      if (!need) continue;
      const take = Math.min(need, left);
      const rTake = round2(take);
      line[cat] = round2((line[cat] || 0) + rTake);
      totals[cat] = round2((totals[cat] || 0) + rTake);
      it.remaining[cat] = round2(need - rTake);
      left = round2(left - rTake);
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
    const row = await LoanSchedule.findOne({
      where: { loanId, period: line.period },
      transaction: t,
      lock: t?.LOCK?.UPDATE, // row-level lock inside tx
    });
    if (!row) continue;

    const rem = remainingFromRow(row);

    const wantP = round2(Number(line.principal || 0) * sign);
    const wantI = round2(Number(line.interest || 0) * sign);
    const wantF = round2(Number(line.fees || 0) * sign);
    const wantPen = round2(Number(line.penalties || 0) * sign);

    const capP = sign > 0 ? rem.principal : Math.min(Number(row.principalPaid || 0), Math.abs(wantP));
    const capI = sign > 0 ? rem.interest : Math.min(Number(row.interestPaid || 0), Math.abs(wantI));
    const capF = sign > 0 ? rem.fees : Math.min(Number(row.feesPaid || 0), Math.abs(wantF));
    const capPen = sign > 0 ? rem.penalties : Math.min(Number(row.penaltiesPaid || 0), Math.abs(wantPen));

    const dP = round2(sign > 0 ? Math.min(Math.abs(wantP), capP) : -Math.min(Math.abs(wantP), capP));
    const dI = round2(sign > 0 ? Math.min(Math.abs(wantI), capI) : -Math.min(Math.abs(wantI), capI));
    const dF = round2(sign > 0 ? Math.min(Math.abs(wantF), capF) : -Math.min(Math.abs(wantF), capF));
    const dPen = round2(sign > 0 ? Math.min(Math.abs(wantPen), capPen) : -Math.min(Math.abs(wantPen), capPen));

    const newPrincipalPaid = max0(round2((row.principalPaid || 0) + dP));
    const newInterestPaid = max0(round2((row.interestPaid || 0) + dI));
    const newFeesPaid = max0(round2((row.feesPaid || 0) + dF));
    const newPenaltiesPaid = max0(round2((row.penaltiesPaid || 0) + dPen));

    const incSum = round2(
      (newPrincipalPaid - (row.principalPaid || 0)) +
        (newInterestPaid - (row.interestPaid || 0)) +
        (newFeesPaid - (row.feesPaid || 0)) +
        (newPenaltiesPaid - (row.penaltiesPaid || 0))
    );

    const rawPaid = round2((row.paid || 0) + incSum);
    const total = Number(
      row.total != null
        ? row.total
        : (row.principal || 0) +
            (row.interest || 0) +
            (row.fees || 0) +
            (row.penalties || row.penalty || 0)
    );

    const newPaid = Math.min(Math.max(0, rawPaid), total);

    const status =
      newPaid >= total - 0.01
        ? "paid"
        : new Date(row.dueDate) < new Date(asOfDate || new Date())
        ? "overdue"
        : "upcoming";

    await row.update(
      {
        principalPaid: round2(newPrincipalPaid),
        interestPaid: round2(newInterestPaid),
        feesPaid: round2(newFeesPaid),
        penaltiesPaid: round2(newPenaltiesPaid),
        paid: round2(newPaid),
        status,
      },
      { transaction: t }
    );
  }
}

/* ============================================================
   📥 LIST
   - Added: method, minAmount, maxAmount filters
   ============================================================ */
const getAllRepayments = async (req, res) => {
  try {
    const {
      q = "",
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      status, // allow filtering by status
      method,
      minAmount,
      maxAmount,
      page = 1,
      pageSize = 20,
    } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    if (status && (Repayment.rawAttributes || {}).status) {
      where.status = status;
    }
    if (method && (Repayment.rawAttributes || {}).method) {
      where.method = method;
    }
    if (amtAttr && (minAmount || maxAmount)) {
      where[amtAttr] = {};
      if (minAmount) where[amtAttr][Op.gte] = Number(minAmount);
      if (maxAmount) where[amtAttr][Op.lte] = Number(maxAmount);
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    let borrowerWhere;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      borrowerWhere = {
        [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }],
      };
    }

    const inc = await loanInclude({
      where: loanWhere,
      borrowerWhere,
      needAmounts: false,
    });
    if (q && q.trim()) inc.required = true;

    const { rows, count } = await Repayment.findAndCountAll({
      where,
      include: [inc],
      order: [
        [dateAttr, "DESC"],
        ["createdAt", "DESC"],
      ],
      limit,
      offset,
    });

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

/* ============================================================
   🔍 BY BORROWER / LOAN
   ============================================================ */
const getRepaymentsByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const dateAttr = repaymentDateAttr();

    const repayments = await Repayment.findAll({
      include: [await loanInclude({ where: { borrowerId } })],
      order: [
        [dateAttr, "DESC"],
        ["createdAt", "DESC"],
      ],
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
      include: [await loanInclude()],
      order: [
        [dateAttr, "DESC"],
        ["createdAt", "DESC"],
      ],
    });
    res.json(repayments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching loan repayments" });
  }
};

const getRepaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }
    const repayment = await Repayment.findByPk(id, {
      include: [await loanInclude()],
    });
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const allocation = repayment.allocation || [];
    res.json(shapeReceipt(repayment, allocation));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching repayment" });
  }
};

/* ============================================================
   🧮 PREVIEW
   ============================================================ */
const previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;

    const loan = await Loan.findByPk(loanId, {
      attributes: await pickExistingLoanAttributes(LOAN_BASE_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS }],
    });
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

// GET variant to support /repayments/preview-allocation?q...
const previewAllocationQuery = async (req, res) => {
  try {
    const loanId = req.query.loanId;
    const amount = Number(req.query.amount || 0);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const strategy = req.query.strategy;
    const customOrder = req.query.customOrder;
    const waivePenalties =
      String(req.query.waivePenalties || "").toLowerCase() === "true";

    req.body = { loanId, amount, date, strategy, customOrder, waivePenalties };
    return previewAllocation(req, res);
  } catch (err) {
    console.error("previewAllocation(GET) error:", err);
    res.status(500).json({ error: "Preview allocation failed" });
  }
};

/* ============================================================
   helpers: safe Savings write
   ============================================================ */
async function createSavingsDepositSafely({
  borrowerId,
  amount,
  date,
  reference,
  narrative,
}) {
  if (!hasSavings) return;
  try {
    const attrs = SavingsTransaction.rawAttributes || {};
    const payload = {};

    if (attrs.borrowerId) payload.borrowerId = borrowerId;
    if (attrs.amount) payload.amount = Number(amount);
    if (attrs.type) payload.type = "deposit";
    if (attrs.date) payload.date = date;
    if (attrs.reference) payload.reference = reference;
    if (attrs.narrative) payload.narrative = narrative;
    if (attrs.status) payload.status = "posted";
    if (attrs.reversed) payload.reversed = false;

    await SavingsTransaction.create(payload);
  } catch (e) {
    // Unique reference collision -> retry once
    const code = e?.parent?.code || e?.original?.code;
    if (code === "23505") {
      try {
        await SavingsTransaction.create({
          borrowerId,
          amount: Number(amount),
          type: "deposit",
          date,
          reference: `${reference}-${Date.now()}`,
          narrative,
          status: "posted",
          reversed: false,
        });
        return;
      } catch (ee) {
        console.warn("Savings deposit retry failed:", ee?.message || ee);
      }
    }
    console.warn("Savings deposit skipped:", e?.message || e);
  }
}

/* ============================================================
   💰 CREATE (manual, immediate post)
   ------------------------------------------------------------
   Permission: "repayments:create:manual"
   Role fallback (until permissions are fully set up):
   ["admin", "loanofficer", "loan_officer", "loan-officer"]
   ============================================================ */
const createRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:create:manual", allowedRoles)) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:create:manual' or sufficient role" });
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
      return res
        .status(400)
        .json({ error: "loanId, amount and date are required" });
    }

    const loan = await Loan.findByPk(loanId, {
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
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

    const payload = {
      loanId,
      amountPaid: Number(amount),
      paymentDate: date,
      method,
      reference: reference || null,
      notes: notes || null,
      allocation: allocations,
      currency: loan.currency || "TZS",
      status: "approved",
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
    await applyAllocationToSchedule({
      loanId,
      allocations,
      asOfDate: date,
      t,
      sign: +1,
    });
    await updateLoanFinancials(loan, +Number(amount), t);

    await t.commit();

    // Savings deposit after commit
    const refForSavings = repayment.reference || reference || `RCPT-${repayment.id}`;
    await createSavingsDepositSafely({
      borrowerId: loan.borrowerId,
      amount: Number(amount),
      date,
      reference: refForSavings,
      narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
    });

    // Notify borrower (best effort)
    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(amount),
      loanRef: loan.reference || loan.id,
      method,
    });

    const repFull = await Repayment.findByPk(repayment.id, {
      include: [await loanInclude()],
    });

    res.status(201).json({
      repaymentId: repayment.id,
      receipt: issueReceipt ? shapeReceipt(repFull || repayment, allocations) : undefined,
      totals,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Create repayment error:", err);
    const code = err?.parent?.code || err?.original?.code;
    if (code === "23503") return res.status(422).json({ error: "Foreign key constraint failed" });
    if (code === "23502") return res.status(422).json({ error: "Missing required field" });
    if (code === "23505") return res.status(409).json({ error: "Duplicate value" });
    res.status(500).json({ error: "Error saving repayment" });
  }
};

/* ============================================================
   ✨ BULK JSON (PENDING rows)
   Permission: "repayments:bulk:create"
   Fallback roles: admin, loanofficer
   ============================================================ */
const createBulkRepayments = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:bulk:create", allowedRoles)) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:bulk:create' or sufficient role" });
    }

    const itemsInput = Array.isArray(req.body)
      ? req.body
      : req.body?.items || req.body?.rows || [];
    const items = Array.isArray(itemsInput) ? itemsInput : [];
    if (!items.length) {
      await t.rollback();
      return res.status(400).json({ error: "Provide an array of repayments" });
    }

    const hasRef = await loanRefSupported();
    const created = [];

    for (const it of items) {
      const {
        loanId: inLoanId,
        loanReference,
        loanRef,
        amount,
        date,
        method = "cash",
        reference,
        notes,
      } = it;

      let loan = null;
      if (inLoanId) {
        loan = await Loan.findByPk(inLoanId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      } else if (loanReference || loanRef) {
        if (!hasRef) {
          await t.rollback();
          return res.status(409).json({
            error: "Loan reference column not available. Run the migration first.",
          });
        }
        loan = await Loan.findOne({
          where: { reference: loanReference || loanRef },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      if (!loan)
        throw new Error(
          `Loan not found (loanId=${inLoanId || "N/A"}; loanReference=${
            loanReference || loanRef || "N/A"
          })`
        );

      const payload = {
        loanId: loan.id,
        amountPaid: Number(amount),
        paymentDate: date,
        method,
        reference: reference || null,
        notes: notes || null,
        status: "pending",
        applied: false,
        currency: loan.currency || "TZS",
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const r = await Repayment.create(payload, { transaction: t });
      created.push(r.id);
    }

    await t.commit();
    res
      .status(201)
      .json({ message: "Bulk repayments queued for approval", ids: created });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Bulk create error:", err);
    res.status(500).json({ error: err.message || "Bulk creation failed" });
  }
};

/* ============================================================
   📄 CSV UPLOAD (PENDING rows)
   Permission: "repayments:csv:upload"
   Fallback roles: admin, loanofficer
   ============================================================ */
const parseCsvBuffer = async (buffer) => {
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row = {};
    header.forEach((h, idx) => (row[h] = cols[idx]));
    out.push(row);
  }
  return out;
};

const uploadRepaymentsCsv = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:csv:upload", allowedRoles)) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:csv:upload' or sufficient role" });
    }

    let buf = null;
    if (req.file?.buffer) buf = req.file.buffer;
    else if (req.file?.path) buf = fs.readFileSync(req.file.path);
    if (!buf) {
      await t.rollback();
      return res
        .status(400)
        .json({ error: 'CSV file missing (field name "file")' });
    }

    const hasRef = await loanRefSupported();
    if (!hasRef) {
      await t.rollback();
      return res.status(409).json({
        error: "Loan reference column not available. Run the migration first.",
      });
    }

    const rows = await parseCsvBuffer(buf);
    if (!rows.length) {
      await t.rollback();
      return res.status(400).json({ error: "CSV is empty" });
    }

    const created = [];
    for (const r of rows) {
      const loanRef = r.loanRef || r.loanReference || r.loan_ref || r.reference;
      const loan = await Loan.findOne({
        where: { reference: loanRef },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!loan) throw new Error(`Loan not found for reference ${loanRef}`);

      const payload = {
        loanId: loan.id,
        amountPaid: Number(r.amount || 0),
        paymentDate: r.date,
        method: r.method || "cash",
        reference: r.reference || null,
        notes: r.notes || null,
        status: "pending",
        applied: false,
        currency: loan.currency || "TZS",
      };
      const attrs = Repayment.rawAttributes || {};
      for (const k of Object.keys(payload)) if (!(k in attrs)) delete payload[k];

      const rec = await Repayment.create(payload, { transaction: t });
      created.push(rec.id);
    }

    await t.commit();
    res
      .status(201)
      .json({ message: "CSV uploaded, repayments queued for approval", ids: created });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("CSV upload error:", err);
    res.status(500).json({ error: err.message || "CSV upload failed" });
  }
};

/* ============================================================
   ✅ APPROVALS
   Permissions:
     - list:   "repayments:approve:list"
     - approve:"repayments:approve"
     - reject: "repayments:reject"
   Fallback roles: admin, loanofficer
   ============================================================ */
const listPendingApprovals = async (req, res) => {
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:approve:list", allowedRoles)) {
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:approve:list' or sufficient role" });
    }

    const items = await Repayment.findAll({
      where: { status: "pending" },
      include: [await loanInclude()],
      order: [["createdAt", "ASC"]],
    });
    res.json(items);
  } catch (err) {
    console.error("listPendingApprovals error:", err);
    res.status(500).json({ error: "Failed to fetch pending approvals" });
  }
};

const approveRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:approve", allowedRoles)) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:approve' or sufficient role" });
    }

    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!repayment) {
      await t.rollback();
      return res.status(404).json({ error: "Repayment not found" });
    }
    if (repayment.status !== "pending") {
      await t.rollback();
      return res.status(400).json({ error: "Repayment is not pending" });
    }

    const loan = repayment.Loan;
    const date =
      getRepaymentDateValue(repayment) || new Date().toISOString().slice(0, 10);
    const allocations =
      repayment.allocation ||
      (
        await computeAllocations({
          loanId: loan.id,
          amount: getRepaymentAmountValue(repayment),
          date,
        })
      ).allocations;

    await applyAllocationToSchedule({
      loanId: loan.id,
      allocations,
      asOfDate: date,
      t,
      sign: +1,
    });

    const paidThis = getRepaymentAmountValue(repayment);
    await updateLoanFinancials(loan, +Number(paidThis), t);

    await repayment.update(
      { status: "approved", applied: true, allocation: allocations },
      { transaction: t }
    );

    await t.commit();

    // Savings after commit
    const refForSavings = repayment.reference || `RCPT-${repayment.id}`;
    await createSavingsDepositSafely({
      borrowerId: loan.borrowerId,
      amount: Number(paidThis),
      date,
      reference: refForSavings,
      narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
    });

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(paidThis),
      loanRef: loan.reference || loan.id,
      method: repayment.method || "cash",
    });

    res.json({ message: "Repayment approved" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("approveRepayment error:", err);
    res.status(500).json({ error: "Approve failed" });
  }
};

const rejectRepayment = async (req, res) => {
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:reject", allowedRoles)) {
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:reject' or sufficient role" });
    }

    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });
    if (repayment.status !== "pending")
      return res.status(400).json({ error: "Repayment is not pending" });

    await repayment.update({ status: "rejected", applied: false });
    res.json({ message: "Repayment rejected" });
  } catch (err) {
    console.error("rejectRepayment error:", err);
    res.status(500).json({ error: "Reject failed" });
  }
};

/* ============================================================
   🚫 VOID / REVERSE (applied rows)
   Permission: "repayments:void"
   Fallback roles: admin, loanofficer
   ============================================================ */
const voidRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:void", allowedRoles)) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:void' or sufficient role" });
    }

    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!repayment) {
      await t.rollback();
      return res.status(404).json({ error: "Repayment not found" });
    }
    if (repayment.status === "voided") {
      await t.rollback();
      return res.status(400).json({ error: "Already voided" });
    }

    const loan = repayment.Loan;
    const date = getRepaymentDateValue(repayment) || new Date().toISOString();

    if (repayment.applied) {
      if (repayment.allocation?.length) {
        await applyAllocationToSchedule({
          loanId: loan.id,
          allocations: repayment.allocation,
          asOfDate: date,
          t,
          sign: -1,
        });
      }
      const amt = getRepaymentAmountValue(repayment);
      await updateLoanFinancials(loan, -Number(amt || 0), t);
    }

    await repayment.update(
      {
        status: "voided",
        applied: false,
        voidReason: req.body?.voidReason || null,
      },
      { transaction: t }
    );

    await t.commit();
    res.json({ message: "Repayment voided" });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Void repayment error:", err);
    res.status(500).json({ error: "Error voiding repayment" });
  }
};

/* ============================================================
   📊 REPORTS
   (read-only — no extra permission guard here)
   ============================================================ */
const getRepaymentsSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo, loanId, borrowerId, method } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();
    if (!amtAttr) return res.json({ totalAmount: 0, totalCount: 0, byMethod: [] });

    const where = { status: "approved" };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }
    if (method && (Repayment.rawAttributes || {}).method) {
      where.method = method;
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    const include = [await loanInclude({ where: loanWhere })];

    const totalAmount = await Repayment.sum(col(amtAttr), { where, include });
    const totalCount = await Repayment.count({ where, include });

    const byMethodRows = await Repayment.findAll({
      where,
      include,
      attributes: [
        "method",
        [fn("COUNT", col("id")), "count"],
        [fn("SUM", col(amtAttr)), "amount"],
      ],
      group: ["method"],
      order: [[literal("amount"), "DESC"]],
    });

    const byMethod = byMethodRows.map((r) => ({
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
    const { dateFrom, dateTo, granularity = "day" } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();
    if (!amtAttr) return res.json({ series: [] });

    const where = { status: "approved" };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }

    const bucketCol = fn("date_trunc", granularity, col(dateAttr));
    const rows = await Repayment.findAll({
      where,
      attributes: [[bucketCol, "bucket"], [fn("SUM", col(amtAttr)), "amount"]],
      group: ["bucket"],
      order: [[literal("bucket"), "ASC"]],
    });

    const series = rows.map((r) => ({
      date: r.get("bucket"),
      amount: Number(r.get("amount") || 0),
    }));
    res.json({ series });
  } catch (err) {
    console.error("TimeSeries error:", err);
    res.status(500).json({ error: "Failed to build time series" });
  }
};

/* ============================================================
   📤 EXPORT CSV
   Permission: "repayments:export"
   Fallback roles: admin, loanofficer
   ============================================================ */
const exportRepaymentsCsv = async (req, res) => {
  try {
    const allowedRoles = ["admin", "loanofficer", "loan_officer", "loan-officer", "cashier"]; // add your role(s)
    if (!hasPermission(req, "repayments:export", allowedRoles)) {
      return res
        .status(403)
        .json({ error: "Access denied: missing permission 'repayments:export' or sufficient role" });
    }

    const {
      q = "",
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      method,
      minAmount,
      maxAmount,
    } = req.query;
    const dateAttr = repaymentDateAttr();
    const amtAttr = repaymentAmountAttr();

    const where = {};
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
    }
    if (method && (Repayment.rawAttributes || {}).method) {
      where.method = method;
    }
    if (amtAttr && (minAmount || maxAmount)) {
      where[amtAttr] = {};
      if (minAmount) where[amtAttr][Op.gte] = Number(minAmount);
      if (maxAmount) where[amtAttr][Op.lte] = Number(maxAmount);
    }

    const loanWhere = {};
    if (loanId) loanWhere.id = loanId;
    if (borrowerId) loanWhere.borrowerId = borrowerId;

    let borrowerWhere;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      borrowerWhere = {
        [Op.or]: [{ name: { [Op.iLike]: needle } }, { phone: { [Op.iLike]: needle } }],
      };
    }

    const inc = await loanInclude({ where: loanWhere, borrowerWhere });
    if (q && q.trim()) inc.required = true;

    const rows = await Repayment.findAll({
      where,
      include: [inc],
      order: [
        [dateAttr, "DESC"],
        ["createdAt", "DESC"],
      ],
    });

    const headers = [
      "ReceiptNo",
      "Date",
      "Amount",
      "Currency",
      "Method",
      "Reference",
      "Borrower",
      "LoanRef",
      "LoanId",
      "Status",
    ];
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
        `"${r.status || ""}"`,
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

/* ============================================================
   🔔 WEBHOOKS (mobile & bank)
   - Added idempotency via (gateway, gatewayRef) when available
   (These are system callbacks; no user permission checks here.)
   ============================================================ */
async function isDuplicateGatewayRef(kind, gatewayRef) {
  if (!gatewayRef) return false;
  const hasGateway = await repaymentHasColumn("gateway");
  const hasGatewayRef = await repaymentHasColumn("gatewayRef");
  if (!hasGateway || !hasGatewayRef) return false;

  const where = { gateway: kind, gatewayRef };
  return !!(await Repayment.findOne({ where, attributes: ["id"] }));
}

const webhookMobileMoney = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature("mobile", req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: "Invalid signature" });
    }
    const n = Gateway.normalizeWebhook("mobile", req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: "Missing loan reference or amount" });
    }

    if (await isDuplicateGatewayRef("mobile", n.gatewayRef)) {
      await t.rollback();
      return res.json({ ok: true, duplicate: true });
    }

    if (!(await loanRefSupported())) {
      await t.rollback();
      return res
        .status(409)
        .json({ error: "Loan reference column not available. Run the migration first." });
    }

    const loan = await Loan.findOne({
      where: { reference: n.loanReference },
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    const { allocations } = await computeAllocations({
      loanId: loan.id,
      amount: n.amount,
      date: n.paidAt,
    });

    // Build payload guarded by schema
    const basePayload = {
      loanId: loan.id,
      amountPaid: Number(n.amount),
      paymentDate: n.paidAt?.slice(0, 10),
      method: "mobile",
      status: "approved",
      applied: true,
      currency: n.currency || loan.currency || "TZS",
      allocation: allocations,
    };

    // Optional gateway fields
    if (await repaymentHasColumn("gateway")) basePayload.gateway = n.gateway || "mobile";
    if (await repaymentHasColumn("gatewayRef")) basePayload.gatewayRef = n.gatewayRef || null;

    // Optional reference
    if (await repaymentHasColumn("reference")) {
      basePayload.reference = `MM-${n.gatewayRef || Date.now()}`;
    }

    const repayment = await Repayment.create(basePayload, { transaction: t });

    await applyAllocationToSchedule({
      loanId: loan.id,
      allocations,
      asOfDate: n.paidAt,
      t,
      sign: +1,
    });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    await t.commit();

    // Savings after commit
    const refToUse =
      (await repaymentHasColumn("reference")) && repayment.reference
        ? repayment.reference
        : `MM-${n.gatewayRef || repayment.id}`;
    await createSavingsDepositSafely({
      borrowerId: loan.borrowerId,
      amount: Number(n.amount),
      date: n.paidAt?.slice(0, 10),
      reference: refToUse,
      narrative: `Loan repayment deposit (mobile) for ${loan.reference || loan.id}`,
    });

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: "mobile",
    });

    res.json({ ok: true });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Mobile webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
  }
};

const webhookBank = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!Gateway.verifySignature("bank", req.headers, req.rawBody || req.body)) {
      await t.rollback();
      return res.status(401).json({ error: "Invalid signature" });
    }
    const n = Gateway.normalizeWebhook("bank", req.body);
    if (!n?.loanReference || !n.amount) {
      await t.rollback();
      return res.status(400).json({ error: "Missing loan reference or amount" });
    }

    if (await isDuplicateGatewayRef("bank", n.gatewayRef)) {
      await t.rollback();
      return res.json({ ok: true, duplicate: true });
    }

    if (!(await loanRefSupported())) {
      await t.rollback();
      return res
        .status(409)
        .json({ error: "Loan reference column not available. Run the migration first." });
    }

    const loan = await Loan.findOne({
      where: { reference: n.loanReference },
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    const { allocations } = await computeAllocations({
      loanId: loan.id,
      amount: n.amount,
      date: n.paidAt,
    });

    // Build payload guarded by schema
    const basePayload = {
      loanId: loan.id,
      amountPaid: Number(n.amount),
      paymentDate: n.paidAt?.slice(0, 10),
      method: "bank",
      status: "approved",
      applied: true,
      currency: n.currency || loan.currency || "TZS",
      allocation: allocations,
    };

    // Optional gateway fields
    if (await repaymentHasColumn("gateway")) basePayload.gateway = "bank";
    if (await repaymentHasColumn("gatewayRef")) basePayload.gatewayRef = n.gatewayRef || null;

    // Optional reference
    if (await repaymentHasColumn("reference")) {
      basePayload.reference = `BK-${n.gatewayRef || Date.now()}`;
    }

    const repayment = await Repayment.create(basePayload, { transaction: t });

    await applyAllocationToSchedule({
      loanId: loan.id,
      allocations,
      asOfDate: n.paidAt,
      t,
      sign: +1,
    });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    await t.commit();

    // Savings after commit
    const refToUse =
      (await repaymentHasColumn("reference")) && repayment.reference
        ? repayment.reference
        : `BK-${n.gatewayRef || repayment.id}`;
    await createSavingsDepositSafely({
      borrowerId: loan.borrowerId,
      amount: Number(n.amount),
      date: n.paidAt?.slice(0, 10),
      reference: refToUse,
      narrative: `Loan repayment deposit (bank) for ${loan.reference || loan.id}`,
    });

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: "bank",
    });

    res.json({ ok: true });
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error("Bank webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
  }
};

/* ============================================================
   ✏️ UPDATE & DELETE (compat)
   ============================================================ */
const updateRepayment = async (req, res) => {
  try {
    const repayment = await Repayment.findByPk(req.params.id);
    if (!repayment) return res.status(404).json({ error: "Repayment not found" });

    const body = { ...req.body };
    const attrs = (Repayment && Repayment.rawAttributes) || {};

    // Guard common date field variants by schema
    if (body.date && !("date" in attrs)) delete body.date;
    if (body.paymentDate && !("paymentDate" in attrs)) delete body.paymentDate;
    if (body.paidAt && !("paidAt" in attrs)) delete body.paidAt;

    // Don't allow changing loanId via this endpoint (safer)
    if ("loanId" in body) delete body.loanId;

    // Strip any attributes not on the model
    for (const k of Object.keys(body)) {
      if (!(k in attrs)) delete body[k];
    }

    await repayment.update(body);
    res.json(repayment);
  } catch (err) {
    console.error("Update repayment error:", err);
    res.status(500).json({ error: "Error updating repayment" });
  }
};

const deleteRepayment = async (req, res) => {
  // Soft-delete via void logic (reversible and keeps audit)
  return voidRepayment(req, res);
};

/* ============================================================
   EXPORTS
   ============================================================ */
module.exports = {
  // list & fetch
  getAllRepayments,
  getRepaymentsByBorrower,
  getRepaymentsByLoan,
  getRepaymentById,

  // preview
  previewAllocation,
  previewAllocationQuery,

  // create/update/delete
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
