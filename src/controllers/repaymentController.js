// controllers/repaymentController.js
const fs = require("fs");
const { Op, fn, col, literal, Sequelize } = require("sequelize");
const {
  LoanRepayment,
  LoanPayment,
  Loan,
  Borrower,
  LoanSchedule,
  SavingsTransaction,
  Communication,
  User,                 // ⬅️ include User for officer name
  sequelize,
} = require("../models");
// helper: round to 2dp to avoid 0.01 drift
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const Repayment = LoanRepayment || LoanPayment;
const hasSavings = !!SavingsTransaction;

const Notifier = require("../services/notifier")({ Communication, Borrower });
const Gateway = require("../services/paymentGateway")();

/* ============================================================
   SCHEMA PROBE + SAFE ATTRIBUTE PICKERS (Loan + LoanSchedule)
   ============================================================ */
let _loanTableColumns = null; // { [colName]: true }
async function getLoanTableColumns() {
  if (_loanTableColumns) return _loanTableColumns;
  try {
    const qi = sequelize.getQueryInterface();
    // works with {schema, tableName} or string
    const tn = Loan.getTableName();
    const desc = await qi.describeTable(tn);
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

/* ---------- LoanSchedule physical column helpers ---------- */
let _lsCols = null; // { [colName]: true }
function lsAttrToField(attrName) {
  const ra = (LoanSchedule && LoanSchedule.rawAttributes) || {};
  const def = ra[attrName];
  if (!def) return null;
  return def.field || attrName;
}
async function getLoanScheduleColumns() {
  if (_lsCols) return _lsCols;
  try {
    const qi = sequelize.getQueryInterface();
    const tn = LoanSchedule.getTableName();
    const desc = await qi.describeTable(tn);
    _lsCols = Object.fromEntries(Object.keys(desc).map((k) => [k, true]));
  } catch {
    _lsCols = {};
  }
  return _lsCols;
}
function qTableName(Model) {
  const tn = Model.getTableName();
  return typeof tn === "string" ? `"${tn}"` : `"${tn.schema}"."${tn.tableName}"`;
}
function lsP(colCamel, fallbackSnake) {
  // quote physical column for LoanSchedule
  const field = lsAttrToField(colCamel) || fallbackSnake || colCamel;
  return `"${field}"`;
}

const BORROWER_ATTRS = ["id", "name", "firstName", "lastName", "phone", "branchId", "email"];

// Default minimal attributes safe across schema variations
const LOAN_BASE_ATTRS = ["id", "borrowerId", "currency", "reference", "status", "branchId", "createdAt"];
// When we need to compute balances
const LOAN_AMOUNT_ATTRS = [...LOAN_BASE_ATTRS, "amount", "totalInterest", "outstanding", "totalPaid"];

async function loanInclude({ where = {}, borrowerWhere, needAmounts = false } = {}) {
  const attrsWanted = needAmounts ? LOAN_AMOUNT_ATTRS : LOAN_BASE_ATTRS;
  const safeAttrs = await pickExistingLoanAttributes(attrsWanted);

  const borrowerInclude = {
    model: Borrower,
    attributes: BORROWER_ATTRS,
    ...(borrowerWhere ? { where: borrowerWhere } : {}),
    required: !!borrowerWhere,
  };

  const inc = {
    model: Loan,
    ...(safeAttrs ? { attributes: safeAttrs } : {}),
    where,
    include: [borrowerInclude],
  };

  // Try to include loan officer if association exists
  if (User && Loan.associations) {
    const officerAssoc =
      Loan.associations.loanOfficer ||
      Loan.associations.Officer ||
      Loan.associations.User ||
      null;
    if (officerAssoc) {
      inc.include.push({
        model: User,
        as: officerAssoc.as || "loanOfficer",
        attributes: ["id", "name", "firstName", "lastName", "email", "branchId"],
        required: false,
      });
    }
  }

  return inc;
}

async function loanRefSupported() {
  const cols = await getLoanTableColumns();
  return !!cols["reference"];
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

/* ===== Names, outstanding, alias helpers ===== */
const fullName = (row) => {
  const j = row?.toJSON ? row.toJSON() : row || {};
  const explicit = j.name || null;
  const composed = [j.firstName, j.lastName].filter(Boolean).join(" ");
  return (explicit && explicit.trim()) || (composed && composed.trim()) || null;
};
const computeOutstandingFromLoanRow = (j) => {
  const pick = (obj, names) => {
    for (const n of names) if (obj[n] != null) return obj[n];
    return undefined;
  };
  const tot = pick(j, ["outstanding", "outstandingAmount", "outstandingTotal"]);
  if (typeof tot === "number") return tot;
  const p = pick(j, ["principalOutstanding", "principal_outstanding"]);
  const i = pick(j, ["interestOutstanding", "interest_outstanding"]);
  if (typeof p === "number" || typeof i === "number") return Number(p || 0) + Number(i || 0);
  return Number(j.amount || 0) - Number(j.totalPaid || 0);
};
function resolveAssocAlias(Host, Target) {
  if (!Host?.associations) return null;
  for (const [k, a] of Object.entries(Host.associations)) {
    if (a?.target === Target) return a.as || k;
  }
  if (Target === Borrower) return Host.associations?.Borrower?.as || "Borrower";
  if (Target === User) return Host.associations?.loanOfficer?.as || "loanOfficer";
  return null;
}

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
    const principalDue = Math.max(0, Number(s.principal || 0) - Number(s.principalPaid || 0));
    const interestDue = Math.max(0, Number(s.interest || 0) - Number(s.interestPaid || 0));
    const feesDue = Math.max(0, Number(s.fees || 0) - Number(s.feesPaid || 0));
    const penDue = Math.max(0, Number(s.penalties ?? s.penalty ?? 0) - Number(s.penaltiesPaid || 0));
    return {
      period: s.period ?? idx + 1,
      dueDate: s.dueDate,
      remaining: {
        principal: Number.isFinite(principalDue) ? principalDue : 0,
        interest: Number.isFinite(interestDue) ? interestDue : 0,
        fees: Number.isFinite(feesDue) ? feesDue : 0,
        penalties: waivePenalties ? 0 : Number.isFinite(penDue) ? penDue : 0,
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

async function applyAllocationToSchedule({ loanId, allocations, asOfDate, t, sign = +1 }) {
  if (!LoanSchedule || !allocations?.length) return;

  const asOf = asOfDate ? new Date(asOfDate) : new Date();

  for (const line of allocations) {
    const row = await LoanSchedule.findOne({ where: { loanId, period: line.period }, transaction: t });
    if (!row) continue;

    // compute next paid subtotals
    const nextPrincipalPaid = r2(Number(row.principalPaid || 0) + sign * Number(line.principal || 0));
    const nextInterestPaid  = r2(Number(row.interestPaid  || 0) + sign * Number(line.interest  || 0));
    const nextFeesPaid      = r2(Number(row.feesPaid      || 0) + sign * Number(line.fees      || 0));
    const nextPensPaid      = r2(Number(row.penaltiesPaid || 0) + sign * Number(line.penalties || 0));

    // figure out what was originally due for the period
    const duePrincipal = r2(Number(row.principal  ?? 0));
    const dueInterest  = r2(Number(row.interest   ?? 0));
    const dueFees      = r2(Number(row.fees       ?? 0));
    const duePens      = r2(Number(row.penalties  ?? row.penalty ?? 0));

    const totalDue  = r2(duePrincipal + dueInterest + dueFees + duePens);
    const totalPaid = r2(nextPrincipalPaid + nextInterestPaid + nextFeesPaid + nextPensPaid);

    // period state
    const fullySettled = totalPaid >= totalDue - 0.01; // epsilon for rounding
    const status = fullySettled
      ? "paid"
      : (row.dueDate ? new Date(row.dueDate) : asOf) < asOf
        ? "overdue"
        : "upcoming";

    // build update doc — IMPORTANT: paid is boolean (no numeric writes)
    const updateDoc = {
      principalPaid: Math.max(0, nextPrincipalPaid),
      interestPaid:  Math.max(0, nextInterestPaid),
      feesPaid:      Math.max(0, nextFeesPaid),
      penaltiesPaid: Math.max(0, nextPensPaid),
      paid:          !!fullySettled,   // ✅ boolean
      status,                          // ✅ enum value
      updated_at: new Date(),
    };

    await row.update(updateDoc, { transaction: t });
  }
}


/* ============================================================
   🗓️  REPAYMENT SCHEDULE LIST  (New for your page)
   - Joins Loan → Borrower and Loan → Officer safely
   - Computes earliest unpaid installment (LoanSchedule) per loan
   - Supports filters: q, branchId, officerId, status, dueRange
   ============================================================ */
async function buildNextDueLiteral(dueRange = "next30") {
  if (!LoanSchedule || !sequelize) return literal("NULL");
  await getLoanScheduleColumns(); // warm cache

  const qTbl = qTableName(LoanSchedule);
  const loanIdCol = lsP("loanId", "loan_id");
  const dueCol    = lsP("dueDate", "due_date");

  const pCol   = lsP("principal");
  const iCol   = lsP("interest");
  const fCol   = lsP("fees");
  const penCol = lsP("penalties", "penalty");

  const ppCol   = lsP("principalPaid", "principal_paid");
  const ipCol   = lsP("interestPaid",  "interest_paid");
  const fpCol   = lsP("feesPaid",      "fees_paid");
  const penpCol = lsP("penaltiesPaid", "penalties_paid");

  const unpaidCond = `COALESCE(${ppCol},0)+COALESCE(${ipCol},0)+COALESCE(${fpCol},0)+COALESCE(${penpCol},0) < COALESCE(${pCol},0)+COALESCE(${iCol},0)+COALESCE(${fCol},0)+COALESCE(${penCol},0)`;

  let rangeSql = "";
  const key = String(dueRange).toLowerCase();
  if (key === "overdue") {
    rangeSql = `AND ls.${dueCol} < NOW()`;
  } else if (key === "next7" || key === "next_7" || key === "next 7 days") {
    rangeSql = `AND ls.${dueCol} >= NOW() AND ls.${dueCol} <= NOW() + INTERVAL '7 days'`;
  } else if (key === "all") {
    rangeSql = ``; // any unpaid regardless of date
  } else {
    // default next30
    rangeSql = `AND ls.${dueCol} >= NOW() AND ls.${dueCol} <= NOW() + INTERVAL '30 days'`;
  }

  const sql = `(SELECT MIN(ls.${dueCol})
                  FROM ${qTbl} ls
                 WHERE ls.${loanIdCol} = "Loan"."id"
                   AND (${unpaidCond})
                   ${rangeSql})`;
  return literal(sql);
}

const listSchedule = async (req, res) => {
  try {
    if (!Loan) return res.json({ items: [], total: 0 });

    const {
      q = "",
      branchId,
      officerId,
      status = "active",          // "active" | "all" | explicit code
      dueRange = "next30",        // "next30" | "next7" | "overdue" | "all"
      page = 1,
      pageSize = 50,
      includeClosed,              // truthy to include closed/settled
    } = req.query;

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    // Where on Loan
    const loanCols = await getLoanTableColumns();
    const where = {};

    // Status logic
    const wantAll = String(status).toLowerCase() === "all" || String(includeClosed).toLowerCase() === "true";
    if (!wantAll && loanCols["status"]) {
      const s = String(status).toLowerCase();
      if (s === "active") {
        where.status = { [Op.in]: ["active", "disbursed", "current"] };
      } else {
        where.status = status;
      }
    }

    // Officer filter
    if ((loanCols["loan_officer_id"] || loanCols["loanOfficerId"]) && officerId) {
      where.loanOfficerId = officerId;
    }

    // Branch filter: prefer Loan.branchId; otherwise via Borrower.branchId
    let borrowerWhere;
    if (branchId) {
      if (loanCols["branch_id"] || loanCols["branchId"]) {
        where.branchId = branchId;
      } else {
        borrowerWhere = { ...(borrowerWhere || {}), branchId };
      }
    }

    // Search by loan ref / borrower
    const likeOp = (sequelize?.getDialect?.() === "postgres") ? Op.iLike : Op.like;
    if (q && q.trim()) {
      const needle = `%${q.trim()}%`;
      where[Op.or] = [
        ...(loanCols["reference"] ? [{ reference: { [likeOp]: needle } }] : []),
        ...(loanCols["code"]      ? [{ code:      { [likeOp]: needle } }] : []),
        ...(loanCols["number"]    ? [{ number:    { [likeOp]: needle } }] : []),
      ];
      borrowerWhere = {
        ...(borrowerWhere || {}),
        [Op.or]: [{ name: { [likeOp]: needle } }, { phone: { [likeOp]: needle } }],
      };
    }

    // figure out include aliases
    const borrowerAlias = resolveAssocAlias(Loan, Borrower) || "Borrower";
    const officerAlias  = resolveAssocAlias(Loan, User)     || "loanOfficer";

    // include
    const include = [];
    if (Borrower && Loan.associations && Loan.associations[borrowerAlias]) {
      include.push({
        model: Borrower,
        as: borrowerAlias,
        attributes: BORROWER_ATTRS,
        ...(borrowerWhere ? { where: borrowerWhere, required: true } : { required: false }),
      });
    }
    if (User && Loan.associations && Loan.associations[officerAlias]) {
      include.push({
        model: User,
        as: officerAlias,
        attributes: ["id", "name", "firstName", "lastName", "email"],
        required: false,
      });
    }

    // compute next due date per loan from LoanSchedule
    const nextDueLit = await buildNextDueLiteral(dueRange);

    // Choose a safe createdAt / id fallback for deterministic ordering
    const createdAttr =
      (Loan.rawAttributes?.createdAt && "createdAt") ||
      (Loan.rawAttributes?.created_at && "created_at") ||
      "id";

    const { rows, count } = await Loan.findAndCountAll({
      where,
      include,
      attributes: {
        include: [[nextDueLit, "nextDueDate"]],
      },
      order: [
        [sequelize.literal('"nextDueDate" IS NULL'), "ASC"], // non-null first
        [sequelize.literal('"nextDueDate"'), "ASC"],
        [createdAttr, "DESC"],
      ],
      limit,
      offset,
      subQuery: false,
    });

    const items = rows.map((r) => {
      const j = r.toJSON ? r.toJSON() : r;

      // loan ref
      const loanRef = j.reference || j.code || j.number || `LN-${j.id}`;

      // borrower & officer names
      const b = j[borrowerAlias];
      const o = j[officerAlias];
      const borrowerName = fullName(b) || "";
      const officerName  = fullName(o) || (o?.email || "") || "";

      // outstanding
      const outstanding = Number(computeOutstandingFromLoanRow(j) || 0);

      return {
        id: j.id,
        loanRef,
        borrowerId: b?.id || null,
        borrowerName,
        officerId: o?.id || null,
        officerName,
        outstanding,
        nextDueDate: j.nextDueDate || null,
        status: j.status || j.state || "—",
      };
    });

    res.json({
      items,
      total: count,
      page: Number(page),
      limit,
    });
  } catch (err) {
    console.error("repayment schedule list error:", err);
    res.status(500).json({ error: "Failed to load repayment schedule" });
  }
};


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
      order: [[literal("amount"), "DESC"]], // sort by sum desc
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
  // schedule (NEW)
  listSchedule,

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
