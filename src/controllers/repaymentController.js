// controllers/repaymentController.js
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

/* ============================================================
   SCHEMA PROBE + SAFE ATTRIBUTE PICKER
   ============================================================ */
let _loanTableColumns = null; // { [colName]: true }
async function getLoanTableColumns() {
  if (_loanTableColumns) return _loanTableColumns;
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable("loans"); // { colName: {...}, ... }
    _loanTableColumns = Object.fromEntries(Object.keys(desc).map((k) => [k, true]));
  } catch {
    _loanTableColumns = {};
  }
  return _loanTableColumns;
}

function mapAttrToField(attrName) {
  const ra = Loan.rawAttributes || {};
  const def = ra[attrName];
  if (!def) return null;
  return def.field || attrName;
}

async function pickExistingLoanAttributes(attrNames = []) {
  const cols = await getLoanTableColumns();
  const selected = [];
  for (const name of attrNames) {
    const field = mapAttrToField(name);
    if (!field) continue;
    if (cols[field]) selected.push(name);
  }
  if (!selected.includes("id") && cols["id"]) selected.push("id");
  return selected.length ? selected : undefined;
}

const BORROWER_ATTRS = ["id", "name", "phone", "email"];

// Default minimal attributes safe across schema variations
const LOAN_BASE_ATTRS = ["id", "borrowerId", "currency", "reference"];
// When we need to compute balances
const LOAN_AMOUNT_ATTRS = [...LOAN_BASE_ATTRS, "amount", "totalInterest", "outstanding", "totalPaid"];

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

/* ============================================================
   LoanSchedule schema-awareness (camelCase vs snake_case)
   ============================================================ */
let _scheduleAttrCache = null;
/**
 * Returns a map of logical schedule fields -> actual attribute names on the model
 * We prefer model rawAttributes (Sequelize-level names), which work for row.get()/update()
 */
function getScheduleAttrMap() {
  if (_scheduleAttrCache) return _scheduleAttrCache;

  const ra = (LoanSchedule && LoanSchedule.rawAttributes) || {};

  const pick = (...candidates) => {
    for (const c of candidates) {
      if (ra[c]) return c; // model attr exists
    }
    return null;
  };

  // Base components (both "penalties" and "penalty" variants are common)
  const penaltiesKey = pick("penalties", "penalty", "penaltiesAmount", "penaltyAmount");
  const penaltiesPaidKey = pick("penaltiesPaid", "penaltyPaid", "penalties_paid", "penalty_paid");

  _scheduleAttrCache = {
    // scheduled amounts
    principal: pick("principal", "principal_amount", "principalAmount"),
    interest: pick("interest", "interest_amount", "interestAmount"),
    fees: pick("fees", "fee", "fees_amount", "feeAmount", "feesAmount"),
    penalties: penaltiesKey,

    // paid trackers
    principalPaid: pick("principalPaid", "principal_paid"),
    interestPaid: pick("interestPaid", "interest_paid"),
    feesPaid: pick("feesPaid", "feePaid", "fees_paid", "fee_paid"),
    penaltiesPaid: penaltiesPaidKey,

    // other columns
    period: pick("period", "installmentNo", "installment_no"),
    dueDate: pick("dueDate", "due_date"),
    total: pick("total", "totalDue", "total_due", "installmentAmount", "installment_amount"),
    paid: pick("paid", "amountPaid", "amount_paid"),
    status: pick("status", "state"),
  };

  return _scheduleAttrCache;
}

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
  return Number(r.amount != null ? r.amount : r.amountPaid != null ? r.amountPaid : 0);
}

/* ============== math helpers (robust allocation math) ============== */
const EPS = 1e-6;
const toNum = (n) => (Number.isFinite(+n) ? +n : 0);
const round2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
const clampNonNeg = (n) => (n > 0 ? n : 0);

/* ===== Safely update loan totals (avoid touching non-existent columns) ===== */
async function updateLoanFinancials(loan, deltaPaid, t) {
  // deltaPaid: +amount when approving/applying; -amount when voiding/reversing
  const cols = await getLoanTableColumns();
  const updates = {};

  const totalPaidField = mapAttrToField("totalPaid");
  if (totalPaidField && cols[totalPaidField]) {
    updates.totalPaid = Math.max(0, Number(loan.totalPaid || 0) + Number(deltaPaid || 0));
  }

  const outstandingField = mapAttrToField("outstanding");
  if (outstandingField && cols[outstandingField]) {
    // Prefer adjusting from current outstanding if present
    if (loan.outstanding != null) {
      updates.outstanding = Math.max(0, Number(loan.outstanding || 0) - Number(deltaPaid || 0));
    } else {
      // Fallback derive if amount + totalInterest are available
      const principal = Number(loan.amount || 0);
      const totalInterest = Number(loan.totalInterest || 0);
      const newTotalPaid =
        updates.totalPaid != null ? updates.totalPaid : Math.max(0, Number(loan.totalPaid || 0) + Number(deltaPaid || 0));
      updates.outstanding = Math.max(0, principal + totalInterest - newTotalPaid);
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
async function computeAllocations({
  loanId,
  amount,
  date,
  strategy = "oldest_due_first",
  customOrder,
  waivePenalties = false,
}) {
  const payAmount = round2(toNum(amount));
  if (!loanId || payAmount <= 0 || !LoanSchedule) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  const A = getScheduleAttrMap();

  // Pull schedule rows
  const schedule = await LoanSchedule.findAll({
    where: { loanId },
    order: [
      [A.dueDate || "id", "ASC"],
      [A.period || "id", "ASC"],
    ],
    raw: true,
  });

  if (!schedule.length) {
    return {
      allocations: [],
      totals: { principal: 0, interest: 0, fees: 0, penalties: 0 },
    };
  }

  // Normalize each row and compute remaining components safely
  const items = schedule.map((s, idx) => {
    const principalDue = clampNonNeg(round2(toNum(s[A.principal]) - toNum(s[A.principalPaid])));
    const interestDue  = clampNonNeg(round2(toNum(s[A.interest])  - toNum(s[A.interestPaid])));
    const feesDue      = clampNonNeg(round2(toNum(s[A.fees])      - toNum(s[A.feesPaid])));
    const penKeyValue  = A.penalties ? toNum(s[A.penalties]) : toNum(s.penalties ?? s.penalty);
    const penPaidVal   = A.penaltiesPaid ? toNum(s[A.penaltiesPaid]) : toNum(s.penaltiesPaid ?? s.penaltyPaid);
    const penDue       = clampNonNeg(round2(penKeyValue - penPaidVal));

    return {
      period: s[A.period] ?? idx + 1,
      dueDate: s[A.dueDate] || s.due_date || null,
      remaining: {
        principal: principalDue,
        interest:  interestDue,
        fees:      feesDue,
        penalties: waivePenalties ? 0 : penDue,
      },
    };
  });

  // Decide allocation order
  let order;
  if (strategy === "principal_first") order = ["principal", "interest", "fees", "penalties"];
  else if (strategy === "interest_first") order = ["interest", "fees", "penalties", "principal"];
  else if (strategy === "fees_first") order = ["fees", "interest", "penalties", "principal"];
  else if (strategy === "custom")
    order = String(customOrder || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  else order = ["penalties", "interest", "fees", "principal"]; // default oldest_due_first cat order

  if (waivePenalties) order = order.filter((x) => x !== "penalties");

  let left = payAmount;
  const allocations = [];
  const totals = { principal: 0, interest: 0, fees: 0, penalties: 0 };

  for (const it of items) {
    if (left <= EPS) break;
    const line = { period: it.period, principal: 0, interest: 0, fees: 0, penalties: 0 };

    for (const cat of order) {
      if (left <= EPS) break;
      const need = clampNonNeg(round2(toNum(it.remaining[cat])));
      if (need <= EPS) continue;

      // take up to need, with 2dp rounding to avoid drifts
      const take = round2(Math.min(need, left));
      if (take <= EPS) continue;

      line[cat] = round2(line[cat] + take);
      totals[cat] = round2(totals[cat] + take);
      it.remaining[cat] = round2(need - take);
      left = round2(left - take);
    }

    if (line.principal || line.interest || line.fees || line.penalties) {
      allocations.push(line);
    }
  }

  // If a cent (or less) is left because of rounding, add it to the last non-zero bucket, preferring principal
  if (left > EPS && allocations.length) {
    const last = allocations[allocations.length - 1];
    const bumpCat = ["principal", "interest", "fees", "penalties"].find((k) => last[k] > 0) || "principal";
    last[bumpCat] = round2(last[bumpCat] + left);
    totals[bumpCat] = round2(totals[bumpCat] + left);
    left = 0;
  }

  return { allocations, totals };
}

/* =========================
   Apply allocation to schedule (schema-aware)
   ======================== */
async function applyAllocationToSchedule({ loanId, allocations, asOfDate, t, sign = +1 }) {
  if (!LoanSchedule || !allocations?.length) return;

  const A = getScheduleAttrMap();

  const updateIfExists = (obj, key, value) => {
    if (key) obj[key] = value;
  };

  for (const line of allocations) {
    const row = await LoanSchedule.findOne({
      where: { loanId, [A.period || "period"]: line.period },
      transaction: t,
    });
    if (!row) continue;

    // Current values
    const cur = {
      principalPaid: toNum(row.get(A.principalPaid)) ,
      interestPaid:  toNum(row.get(A.interestPaid))  ,
      feesPaid:      toNum(row.get(A.feesPaid))      ,
      penaltiesPaid: toNum(A.penaltiesPaid ? row.get(A.penaltiesPaid) : (row.get("penaltiesPaid") ?? row.get("penaltyPaid"))),
      principal:     toNum(row.get(A.principal)),
      interest:      toNum(row.get(A.interest)),
      fees:          toNum(row.get(A.fees)),
      penalties:     toNum(A.penalties ? row.get(A.penalties) : (row.get("penalties") ?? row.get("penalty"))),
      total:         A.total ? toNum(row.get(A.total)) : null,
      dueDate:       A.dueDate ? row.get(A.dueDate) : row.get("due_date"),
    };

    // Apply delta
    const next = {
      principalPaid: clampNonNeg(round2(cur.principalPaid + sign * toNum(line.principal))),
      interestPaid:  clampNonNeg(round2(cur.interestPaid  + sign * toNum(line.interest))),
      feesPaid:      clampNonNeg(round2(cur.feesPaid      + sign * toNum(line.fees))),
      penaltiesPaid: clampNonNeg(round2(cur.penaltiesPaid + sign * toNum(line.penalties))),
    };

    const totalRow = cur.total != null
      ? cur.total
      : round2(cur.principal + cur.interest + cur.fees + cur.penalties);

    const paidSum = clampNonNeg(
      round2(next.principalPaid + next.interestPaid + next.feesPaid + next.penaltiesPaid)
    );

    // Status computation, only if column exists
    let nextStatus;
    if (A.status) {
      const asOf = asOfDate ? new Date(asOfDate) : new Date();
      if (paidSum >= totalRow - 0.01) nextStatus = "paid";
      else if (cur.dueDate && new Date(cur.dueDate) < asOf) nextStatus = "overdue";
      else nextStatus = "upcoming";
    }

    // Persist only columns that exist on this schema
    const updates = {};
    updateIfExists(updates, A.principalPaid, next.principalPaid);
    updateIfExists(updates, A.interestPaid, next.interestPaid);
    updateIfExists(updates, A.feesPaid, next.feesPaid);
    if (A.penaltiesPaid) updateIfExists(updates, A.penaltiesPaid, next.penaltiesPaid);

    // optional aggregate "paid" column
    if (A.paid) updates[A.paid] = paidSum;

    if (A.status && nextStatus) updates[A.status] = nextStatus;

    await row.update(updates, { transaction: t });
  }
}

/* =========================
   📥 LIST
========================== */
const getAllRepayments = async (req, res) => {
  try {
    const {
      q = "",
      loanId,
      borrowerId,
      dateFrom,
      dateTo,
      status, // NEW: allow filtering by status e.g., "pending"
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
      where[dateAttr] = and;
    }

    // optional status filter if model supports it
    if (status && (Repayment.rawAttributes || {}).status) {
      where.status = status;
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

/* ==========================
   🔍 BY BORROWER / LOAN
========================== */
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

/* ==========================
   🧮 PREVIEW
========================== */
const previewAllocation = async (req, res) => {
  try {
    const { loanId, amount, date, strategy, customOrder, waivePenalties } = req.body;

    // Fetch the loan with safe attributes
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

    // Fetch loan with only columns we actually need to compute balances
    const loan = await Loan.findByPk(loanId, {
      attributes: await pickExistingLoanAttributes(LOAN_AMOUNT_ATTRS),
      include: [{ model: Borrower, attributes: BORROWER_ATTRS }],
      transaction: t,
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

    // Build payload flexibly
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
    await applyAllocationToSchedule({ loanId, allocations, asOfDate: date, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(amount), t);

    // Optional: credit borrower savings (auto-deposit)
    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(amount),
          type: "deposit",
          narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
          reference: payload.reference || `RCPT-${repayment.id}`,
          date: date,
        },
        { transaction: t }
      );
    }

    await t.commit();

    // Notify borrower
    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(amount),
      loanRef: loan.reference || loan.id,
      method,
    });

    const repFull = await Repayment.findByPk(repayment.id, { include: [await loanInclude()] });

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
   ✨ BULK JSON (PENDING rows)
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

    // Accept: array body, {items: [...]}, or {rows: [...]}
    const itemsInput = Array.isArray(req.body) ? req.body : req.body?.items || req.body?.rows || [];
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
        loan = await Loan.findByPk(inLoanId, { transaction: t });
      } else if (loanReference || loanRef) {
        if (!hasRef) {
          await t.rollback();
          return res
            .status(409)
            .json({ error: "Loan reference column not available. Run the migration first." });
        }
        loan = await Loan.findOne({
          where: { reference: loanReference || loanRef },
          transaction: t,
        });
      }

      if (!loan)
        throw new Error(
          `Loan not found (loanId=${inLoanId || "N/A"}; loanReference=${loanReference || loanRef || "N/A"})`
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
    res.status(201).json({ message: "Bulk repayments queued for approval", ids: created });
  } catch (err) {
    await t.rollback();
    console.error("Bulk create error:", err);
    res.status(500).json({ error: err.message || "Bulk creation failed" });
  }
};

/* ==========================
   📄 CSV UPLOAD (PENDING rows)
========================== */
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
    // Support memory or disk storage
    let buf = null;
    if (req.file?.buffer) buf = req.file.buffer;
    else if (req.file?.path) buf = fs.readFileSync(req.file.path);
    if (!buf) {
      await t.rollback();
      return res.status(400).json({ error: 'CSV file missing (field name "file")' });
    }

    const hasRef = await loanRefSupported();
    if (!hasRef) {
      await t.rollback();
      return res
        .status(409)
        .json({ error: "Loan reference column not available. Run the migration first." });
    }

    const rows = await parseCsvBuffer(buf);
    if (!rows.length) {
      await t.rollback();
      return res.status(400).json({ error: "CSV is empty" });
    }

    const created = [];
    for (const r of rows) {
      const loanRef = r.loanRef || r.loanReference || r.loan_ref || r.reference;
      const loan = await Loan.findOne({ where: { reference: loanRef }, transaction: t });
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
    await t.rollback();
    console.error("CSV upload error:", err);
    res.status(500).json({ error: err.message || "CSV upload failed" });
  }
};

/* ==========================
   ✅ APPROVALS
========================== */
const listPendingApprovals = async (req, res) => {
  try {
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
    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
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
    const date = getRepaymentDateValue(repayment) || new Date().toISOString().slice(0, 10);
    const allocations =
      repayment.allocation ||
      (
        await computeAllocations({
          loanId: loan.id,
          amount: getRepaymentAmountValue(repayment),
          date,
        })
      ).allocations;

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: date, t, sign: +1 });

    const paidThis = getRepaymentAmountValue(repayment);
    await updateLoanFinancials(loan, +Number(paidThis), t);

    await repayment.update({ status: "approved", applied: true, allocation: allocations }, { transaction: t });

    // Optional savings deposit
    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(paidThis),
          type: "deposit",
          narrative: `Loan repayment deposit for ${loan.reference || loan.id}`,
          reference: repayment.reference || `RCPT-${repayment.id}`,
          date: date,
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(paidThis),
      loanRef: loan.reference || loan.id,
      method: repayment.method || "cash",
    });

    res.json({ message: "Repayment approved" });
  } catch (err) {
    await t.rollback();
    console.error("approveRepayment error:", err);
    res.status(500).json({ error: "Approve failed" });
  }
};

const rejectRepayment = async (req, res) => {
  try {
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

/* ==========================
   🚫 VOID / REVERSE (applied rows)
========================== */
const voidRepayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const repayment = await Repayment.findByPk(req.params.id, {
      include: [await loanInclude({ needAmounts: true })],
      transaction: t,
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
      // reverse schedule & totals
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
      { status: "voided", applied: false, voidReason: req.body?.voidReason || null },
      { transaction: t }
    );

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
    const amtAttr = repaymentAmountAttr();
    if (!amtAttr) return res.json({ totalAmount: 0, totalCount: 0, byMethod: [] });

    const where = { status: "approved" };
    if (dateFrom || dateTo) {
      const and = {};
      if (dateFrom) and[Op.gte] = new Date(dateFrom);
      if (dateTo) and[Op.lte] = new Date(dateTo);
      where[dateAttr] = and;
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

/* ==========================
   🔔 WEBHOOKS (mobile & bank)
========================== */
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

    const repayment = await Repayment.create(
      {
        loanId: loan.id,
        amountPaid: Number(n.amount),
        paymentDate: n.paidAt?.slice(0, 10),
        method: "mobile",
        status: "approved",
        applied: true,
        currency: n.currency || loan.currency || "TZS",
        gateway: n.gateway || "mobile",
        gatewayRef: n.gatewayRef || null,
        reference: `MM-${n.gatewayRef || Date.now()}`,
        allocation: allocations,
      },
      { transaction: t }
    );

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(n.amount),
        type: "deposit",
          narrative: `Loan repayment deposit (mobile) for ${loan.reference || loan.id}`,
          reference: repayment.reference,
          date: n.paidAt?.slice(0, 10),
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: "mobile",
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
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

    const repayment = await Repayment.create(
      {
        loanId: loan.id,
        amountPaid: Number(n.amount),
        paymentDate: n.paidAt?.slice(0, 10),
        method: "bank",
        status: "approved",
        applied: true,
        currency: n.currency || loan.currency || "TZS",
        gateway: "bank",
        gatewayRef: n.gatewayRef || null,
        reference: `BK-${n.gatewayRef || Date.now()}`,
        allocation: allocations,
      },
      { transaction: t }
    );

    await applyAllocationToSchedule({ loanId: loan.id, allocations, asOfDate: n.paidAt, t, sign: +1 });
    await updateLoanFinancials(loan, +Number(n.amount), t);

    if (hasSavings) {
      await SavingsTransaction.create(
        {
          borrowerId: loan.borrowerId,
          amount: Number(n.amount),
          type: "deposit",
          narrative: `Loan repayment deposit (bank) for ${loan.reference || loan.id}`,
          reference: repayment.reference,
          date: n.paidAt?.slice(0, 10),
        },
        { transaction: t }
      );
    }

    await t.commit();

    await Notifier.notifyBorrowerRepayment({
      borrower: loan.Borrower,
      amount: Number(n.amount),
      loanRef: loan.reference || loan.id,
      method: "bank",
    });

    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error("Bank webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
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
