// src/controllers/loanController.js
const {
  Loan,
  Borrower,
  Branch,
  User,
  LoanProduct,
  LoanRepayment, // keep existing import to avoid breaking other parts
  LoanPayment,   // explicit to avoid undefined
  LoanSchedule,
  AuditLog,
  sequelize,
} = require("../models");

const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require("../utils/generateSchedule");

const BORROWER_ATTRS = ["id", "name", "nationalId", "phone"];

// DB statuses (persisted). "active" is derived (disbursed & not closed) and is not persisted.
const DB_ENUM_STATUSES = new Set(["pending", "approved", "rejected", "disbursed", "closed"]);

// Allowed transitions for the persisted enum only
const ALLOWED = {
  pending: ["approved", "rejected"],
  approved: ["disbursed"],
  disbursed: ["closed"],
};

const writeAudit = async ({ entityId, action, before, after, req }) => {
  try {
    if (!AuditLog) return;
    await AuditLog.create({
      entityType: "Loan",
      entityId,
      action,
      before,
      after,
      userId: req.user?.id || null,
      ip: req.ip,
    });
  } catch (e) {
    console.warn("audit write failed:", e.message);
  }
};

/* ====================================================================
   Helpers: discover existing DB columns & build safe attributes/includes
==================================================================== */
let LOAN_COLUMNS_CACHE = null;
let LOAN_TABLE_DESC_CACHE = null;
let USERS_TABLE_DESC_CACHE = null;
let LOAN_PAYMENTS_DESC_CACHE = null;
let LOAN_SCHEDULES_DESC_CACHE = null;

const getTableNameFromModel = (Model, fallback) => {
  const t = Model?.getTableName ? Model.getTableName() : fallback;
  return typeof t === "string" ? t : t?.tableName || fallback;
};

const getLoansTableName = () => getTableNameFromModel(Loan, "loans");
const getUsersTableName = () => getTableNameFromModel(User, "Users");

function normalizePgType(t = "") {
  const s = String(t).toLowerCase();
  if (s.includes("uuid")) return "uuid";
  if (s.includes("int")) return "int"; // covers int2/4/8
  if (s.includes("char") || s.includes("text") || s.includes("varying")) return "text";
  if (s.includes("timestamp") || s.includes("date")) return "date";
  return s || "unknown";
}

async function describeTableCached(tableName) {
  try {
    const qi = sequelize.getQueryInterface();
    if (tableName === getLoansTableName()) {
      if (!LOAN_TABLE_DESC_CACHE) LOAN_TABLE_DESC_CACHE = await qi.describeTable(tableName);
      return LOAN_TABLE_DESC_CACHE;
    }
    if (tableName === getUsersTableName()) {
      if (!USERS_TABLE_DESC_CACHE) USERS_TABLE_DESC_CACHE = await qi.describeTable(tableName);
      return USERS_TABLE_DESC_CACHE;
    }
    if (tableName === "loan_payments") {
      if (!LOAN_PAYMENTS_DESC_CACHE) LOAN_PAYMENTS_DESC_CACHE = await qi.describeTable("loan_payments");
      return LOAN_PAYMENTS_DESC_CACHE;
    }
    if (tableName === "loan_schedules") {
      if (!LOAN_SCHEDULES_DESC_CACHE) LOAN_SCHEDULES_DESC_CACHE = await qi.describeTable("loan_schedules");
      return LOAN_SCHEDULES_DESC_CACHE;
    }
    return await qi.describeTable(tableName);
  } catch {
    return null;
  }
}

async function tableExists(tableName) {
  return !!(await describeTableCached(tableName));
}

async function getLoanColumns() {
  if (LOAN_COLUMNS_CACHE) return LOAN_COLUMNS_CACHE;
  try {
    const desc = await describeTableCached(getLoansTableName());
    if (desc) {
      LOAN_COLUMNS_CACHE = new Set(Object.keys(desc)); // DB field names
      return LOAN_COLUMNS_CACHE;
    }
  } catch {}
  // Fallback: infer from model (may still include non-existent columns)
  LOAN_COLUMNS_CACHE = new Set(
    Object.values(Loan.rawAttributes || {}).map((a) => a.field || a.fieldName || a)
  );
  return LOAN_COLUMNS_CACHE;
}

/** Map a model attr to its DB field name */
function toDbField(attrName) {
  return Loan?.rawAttributes?.[attrName]?.field || attrName;
}

/** Does this logical attr exist as a DB column on loans? */
async function loanColumnExists(attrName) {
  const cols = await getLoanColumns();
  return cols.has(toDbField(attrName));
}

/** Return list of model attribute names whose mapped DB field actually exists */
async function getSafeLoanAttributeNames() {
  const cols = await getLoanColumns();
  const attrs = Loan.rawAttributes || {};
  return Object.keys(attrs).filter((name) => {
    const field = attrs[name]?.field || name;
    return cols.has(field);
  });
}

/**
 * Build includes for the User associations on Loan, but only if the FK type
 * matches Users PK type (prevents integer vs uuid join errors).
 */
async function buildUserIncludesIfPossible() {
  const includes = [];
  const userTableDesc = await describeTableCached(getUsersTableName());
  const loansTableDesc = await describeTableCached(getLoansTableName());

  // Figure out Users PK type (assume "id")
  const usersPkType = normalizePgType(userTableDesc?.id?.type || "unknown");

  // Gather all Loan -> User associations
  const assocEntries = Object.entries(Loan.associations || {}).filter(
    ([, a]) => a?.target === User
  );

  for (const [as, assoc] of assocEntries) {
    const fkAttrName =
      assoc.foreignKey ||
      assoc.foreignKeyAttribute?.fieldName ||
      assoc.foreignKeyAttribute?.field ||
      null;

    if (!fkAttrName) continue;

    const fkDbField = Loan.rawAttributes?.[fkAttrName]?.field || fkAttrName;
    const fkType = normalizePgType(loansTableDesc?.[fkDbField]?.type || "unknown");

    const compatible =
      (fkType === "uuid" && usersPkType === "uuid") ||
      (fkType === "int" && usersPkType === "int");

    if (!compatible) {
      console.warn(
        `[loans] Skipping include '${as}' due to FK/PK type mismatch: loans.${fkDbField} (${fkType}) vs Users.id (${usersPkType})`
      );
      continue;
    }

    includes.push({
      association: assoc,
      attributes: ["id", "name"],
      required: false,
    });
  }

  return includes;
}

/** Check if loans.<fkAttr> type is compatible with Users.id type */
async function loanUserFkIsCompatible(fkAttr /* e.g., 'approvedBy' or 'disbursedBy' */) {
  try {
    const usersDesc = await describeTableCached(getUsersTableName());
    const loansDesc = await describeTableCached(getLoansTableName());
    const usersPkType = normalizePgType(usersDesc?.id?.type || "unknown");
    const fkDbField = Loan.rawAttributes?.[fkAttr]?.field || fkAttr;
    const loanFkType = normalizePgType(loansDesc?.[fkDbField]?.type || "unknown");
    return (
      (usersPkType === "uuid" && loanFkType === "uuid") ||
      (usersPkType === "int" && loanFkType === "int")
    );
  } catch {
    // Be conservative: if we can't tell, don't write FK
    return false;
  }
}

/* ===========================
   Date helper
=========================== */
function addMonthsDateOnly(dateStr, months) {
  // dateStr is "YYYY-MM-DD"
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const targetMonthIndex = dt.getUTCMonth() + Number(months);
  const target = new Date(Date.UTC(dt.getUTCFullYear(), targetMonthIndex, dt.getUTCDate()));
  // Handle end-of-month rollover
  if (target.getUTCMonth() !== ((m - 1 + Number(months)) % 12 + 12) % 12) {
    target.setUTCDate(0);
  }
  return target.toISOString().slice(0, 10);
}

/* ===========================
   CREATE LOAN
=========================== */
const createLoan = async (req, res) => {
  try {
    // Support JSON or multipart { payload: "<json>" }
    const raw = typeof req.body?.payload === "string" ? req.body.payload : null;
    let body = raw ? JSON.parse(raw) : { ...req.body };

    // Name normalization
    if (body.durationMonths != null && body.termMonths == null) {
      body.termMonths = Number(body.durationMonths);
    }
    if (body.releaseDate && !body.startDate) {
      body.startDate = body.releaseDate; // "YYYY-MM-DD"
    }

    // Coerce numerics
    if (body.amount != null) body.amount = Number(body.amount);
    if (body.termMonths != null) body.termMonths = Number(body.termMonths);
    if (body.interestRate != null && body.interestRate !== "") {
      body.interestRate = Number(body.interestRate);
    }

    // Defaults
    if (!body.startDate) {
      const today = new Date();
      body.startDate = today.toISOString().slice(0, 10);
    }
    if (!body.currency) body.currency = "TZS";
    if (!body.repaymentFrequency) body.repaymentFrequency = "monthly";
    if (!body.interestMethod) body.interestMethod = "flat";

    // Requireds
    if (!body.borrowerId) {
      return res.status(400).json({ error: "borrowerId is required" });
    }
    if (!body.productId) {
      return res.status(400).json({ error: "productId is required" });
    }
    if (!Number.isFinite(body.amount) || body.amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!Number.isFinite(body.termMonths) || body.termMonths <= 0) {
      return res.status(400).json({ error: "termMonths must be a positive number" });
    }

    // Product validations + defaults
    const p = await LoanProduct.findByPk(body.productId);
    if (!p) return res.status(400).json({ error: "Invalid loan product selected" });

    const a = Number(body.amount || 0);
    const t = Number(body.termMonths || 0);

    if (p.minPrincipal && a < Number(p.minPrincipal))
      return res.status(400).json({ error: `Amount must be at least ${p.minPrincipal}` });
    if (p.maxPrincipal && a > Number(p.maxPrincipal))
      return res.status(400).json({ error: `Amount must not exceed ${p.maxPrincipal}` });
    if (p.minTermMonths && t < Number(p.minTermMonths))
      return res.status(400).json({ error: `Term must be at least ${p.minTermMonths} months` });
    if (p.maxTermMonths && t > Number(p.maxTermMonths))
      return res.status(400).json({ error: `Term must not exceed ${p.maxTermMonths} months` });

    if (body.interestMethod == null) body.interestMethod = p.interestMethod || "flat";
    if (body.interestRate == null || Number.isNaN(body.interestRate)) {
      body.interestRate = Number(p.interestRate || 0);
    }

    // Ensures DB NOT NULL on endDate
    if (!body.endDate) {
      body.endDate = addMonthsDateOnly(body.startDate, Number(body.termMonths));
    }

    // Persisted status starts as pending
    body.status = "pending";

    // initiatedBy only if present in model AND types match AND column exists
    if (
      "initiatedBy" in (Loan.rawAttributes || {}) &&
      (await loanUserFkIsCompatible("initiatedBy")) &&
      (await loanColumnExists("initiatedBy"))
    ) {
      body.initiatedBy = req.user?.id || null;
    }

    const loan = await Loan.create(body);

    await writeAudit({
      entityId: loan.id,
      action: "create",
      before: null,
      after: loan.toJSON(),
      req,
    });

    res.status(201).json(loan);
  } catch (err) {
    console.error("Create loan error:", err);
    res.status(500).json({ error: "Failed to create loan" });
  }
};

/* ===========================
   LIST LOANS
=========================== */
const getAllLoans = async (req, res) => {
  try {
    const where = {};

    const rawStatus = String(req.query.status || "").toLowerCase();
    const scope = String(req.query.scope || "").toLowerCase();

    if (rawStatus && rawStatus !== "all" && DB_ENUM_STATUSES.has(rawStatus)) {
      where.status = rawStatus;
    }

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const loans = await Loan.findAll({
      where,
      attributes,
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
        { model: LoanProduct },
        ...userIncludes,
      ],
      order: [["createdAt", "DESC"]],
      limit: 500,
    });

    let result = loans;

    if (rawStatus === "active" || scope === "active") {
      result = result.filter((l) => String(l.status || "").toLowerCase() === "disbursed");
    }

    if (scope === "delinquent") {
      result = result.filter((l) => {
        const nd = String(l.nextDueStatus || "").toLowerCase();
        return nd === "overdue" || Number(l.dpd || 0) > 0 || Number(l.arrears || 0) > 0;
      });
    }

    res.json(result || []);
  } catch (err) {
    console.error("Fetch loans error:", err);
    res.status(500).json({ error: "Failed to fetch loans" });
  }
};

/* ============================================
   GET LOAN BY ID (+repayments & schedule)
============================================ */
const getLoanById = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeRepayments = "true", includeSchedule = "true" } = req.query;

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const loan = await Loan.findByPk(id, {
      attributes,
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
        { model: LoanProduct },
        ...userIncludes,
      ],
    });

    if (!loan) return res.status(404).json({ error: "Loan not found" });

    let repayments = [];
    let totals = {
      principal: 0,
      interest: 0,
      fees: 0,
      penalties: 0,
      totalPaid: 0,
      outstanding: Number(loan.amount || 0),
    };

    if (includeRepayments === "true") {
      // Prefer explicit imports (guaranteed), then registry fallbacks
      const RepaymentModel =
        LoanPayment ||
        LoanRepayment ||
        (sequelize.models && (sequelize.models.LoanPayment || sequelize.models.LoanRepayment));

      if (!RepaymentModel || typeof RepaymentModel.findAll !== "function") {
        console.warn("[loans] No repayment model registered; returning empty repayments list");
      } else {
        const attrs = RepaymentModel.rawAttributes || {};
        let orderCol = attrs.paymentDate ? "paymentDate" : attrs.date ? "date" : "createdAt";

        try {
          repayments = await RepaymentModel.findAll({
            where: { loanId: loan.id },
            order: [[orderCol, "DESC"], ["createdAt", "DESC"]],
          });
        } catch (e) {
          console.warn(
            `[loans] repayment query failed (${e.code || e.name}): ${e.message} — retrying with createdAt`
          );
          repayments = await RepaymentModel.findAll({
            where: { loanId: loan.id },
            order: [["createdAt", "DESC"]],
          });
        }

        for (const r of repayments) {
          const alloc = Array.isArray(r.allocation)
            ? r.allocation
            : r.allocation
            ? [r.allocation]
            : [];
          for (const a of alloc) {
            totals.principal += Number(a.principal || 0);
            totals.interest += Number(a.interest || 0);
            totals.fees += Number(a.fees || 0);
            totals.penalties += Number(a.penalties || 0);
          }
          totals.totalPaid += Number(r.amountPaid ?? r.amount ?? r.total ?? 0);
        }

        totals.outstanding = Math.max(
          0,
          Number(loan.amount || 0) + Number(loan.totalInterest || 0) - totals.totalPaid
        );
      }
    }

    let schedule = [];
    if (includeSchedule === "true" && LoanSchedule && typeof LoanSchedule.findAll === "function") {
      if (await tableExists("loan_schedules")) {
        try {
          schedule = await LoanSchedule.findAll({
            where: { loanId: loan.id },
            order: [["period", "ASC"]],
          });
        } catch (e) {
          console.warn(`[loans] schedule query failed: ${e.message}`);
          schedule = [];
        }
      } else {
        console.warn("[loans] loan_schedules table missing; returning empty schedule");
      }
    }

    res.json({
      ...loan.toJSON(),
      totals,
      repayments,
      schedule,
    });
  } catch (err) {
    console.error("Error fetching loan:", err);
    res.status(500).json({ error: "Error fetching loan" });
  }
};

/* ===========================
   UPDATE LOAN
=========================== */
const updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const before = loan.toJSON();
    const body = { ...req.body };
    const productId = body.productId ?? loan.productId;

    if (productId) {
      const p = await LoanProduct.findByPk(productId);
      if (!p) return res.status(400).json({ error: "Invalid loan product selected" });

      const a = Number(body.amount ?? loan.amount);
      const t = Number(body.termMonths ?? loan.termMonths);

      if (p.minPrincipal && a < Number(p.minPrincipal))
        return res.status(400).json({ error: `Amount must be at least ${p.minPrincipal}` });
      if (p.maxPrincipal && a > Number(p.maxPrincipal))
        return res.status(400).json({ error: `Amount must not exceed ${p.maxPrincipal}` });
      if (p.minTermMonths && t < Number(p.minTermMonths))
        return res.status(400).json({ error: `Term must be at least ${p.minTermMonths} months` });
      if (p.maxTermMonths && t > Number(p.maxTermMonths))
        return res.status(400).json({ error: `Term must not exceed ${p.maxTermMonths} months` });

      if (body.interestMethod === undefined)
        body.interestMethod = loan.interestMethod || p.interestMethod || "flat";
      if (body.interestRate === undefined)
        body.interestRate = loan.interestRate || Number(p.interestRate || 0);
    }

    // If termMonths or startDate change and endDate not explicitly provided, recompute
    const willChangeTerm = body.termMonths != null && Number(body.termMonths) !== Number(loan.termMonths);
    const willChangeStart = body.startDate && String(body.startDate) !== String(loan.startDate);
    if (!body.endDate && (willChangeTerm || willChangeStart)) {
      const nextTerm = Number(body.termMonths ?? loan.termMonths);
      const nextStart = String(body.startDate ?? loan.startDate);
      body.endDate = addMonthsDateOnly(nextStart, nextTerm);
    }

    await loan.update(body);

    await writeAudit({
      entityId: loan.id,
      action: "update",
      before,
      after: loan.toJSON(),
      req,
    });

    res.json(loan);
  } catch (err) {
    console.error("Update loan error:", err);
    res.status(500).json({ error: "Error updating loan" });
  }
};

/* ===========================
   DELETE LOAN
=========================== */
const deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const before = loan.toJSON();
    await loan.destroy();

    await writeAudit({
      entityId: loan.id,
      action: "delete",
      before,
      after: null,
      req,
    });

    res.json({ message: "Loan deleted" });
  } catch (err) {
    console.error("Delete loan error:", err);
    res.status(500).json({ error: "Error deleting loan" });
  }
};

/* ===========================
   GENERATE SCHEDULE (Preview)
=========================== */
const getLoanSchedule = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.loanId || req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const input = {
      amount: Number(loan.amount || 0),
      interestRate: Number(loan.interestRate || 0),
      term: loan.termMonths,
      issueDate: loan.startDate,
    };

    const schedule =
      loan.interestMethod === "flat"
        ? generateFlatRateSchedule(input)
        : loan.interestMethod === "reducing"
        ? generateReducingBalanceSchedule(input)
        : [];

    if (!schedule.length) return res.status(400).json({ error: "Invalid interest method" });
    res.json(schedule);
  } catch (err) {
    console.error("Get schedule error:", err);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
};

/* ===========================
   STATUS UPDATE
=========================== */
const updateLoanStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { status, override } = req.body;
    const next = String(status || "").toLowerCase();

    const loan = await Loan.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    if (!ALLOWED[loan.status]?.includes(next)) {
      await t.rollback();
      return res.status(400).json({ error: `Cannot change ${loan.status} → ${next}` });
    }

    // Build fields only for columns that actually exist
    const fields = {};

    if (await loanColumnExists("status")) {
      fields.status = next;
    } else {
      await t.rollback();
      return res.status(500).json({ error: "loans.status column missing" });
    }

    if (next === "approved") {
      // Only set approvedBy if loans.approvedBy exists and FK types match
      if ((await loanColumnExists("approvedBy")) && (await loanUserFkIsCompatible("approvedBy"))) {
        fields.approvedBy = req.user?.id || null;
      }
      if (await loanColumnExists("approvalDate")) {
        fields.approvalDate = new Date();
      }
    }

    if (next === "rejected") {
      if ((await loanColumnExists("rejectedBy")) && (await loanUserFkIsCompatible("rejectedBy"))) {
        fields.rejectedBy = req.user?.id || null;
      }
      if (await loanColumnExists("rejectedDate")) {
        fields.rejectedDate = new Date();
      }
    }

    if (next === "disbursed") {
      if ((await loanColumnExists("disbursedBy")) && (await loanUserFkIsCompatible("disbursedBy"))) {
        fields.disbursedBy = req.user?.id || null;
      }
      if (await loanColumnExists("disbursementDate")) {
        fields.disbursementDate = new Date();
      }

      // Only touch schedule if model + table exist
      if (LoanSchedule && typeof LoanSchedule.count === "function" && (await tableExists("loan_schedules"))) {
        const count = await LoanSchedule.count({ where: { loanId: loan.id }, transaction: t });
        if (count === 0) {
          const input = {
            amount: Number(loan.amount || 0),
            interestRate: Number(loan.interestRate || 0),
            term: loan.termMonths,
            issueDate: loan.startDate,
          };
          const gen =
            loan.interestMethod === "flat"
              ? generateFlatRateSchedule(input)
              : loan.interestMethod === "reducing"
              ? generateReducingBalanceSchedule(input)
              : [];

          const rows = gen.map((s, i) => ({
            loanId: loan.id,
            period: i + 1,
            dueDate: s.dueDate,
            principal: Number(s.principal || 0),
            interest: Number(s.interest || 0),
            fees: Number(s.fees || 0),
            penalties: 0,
            total: Number(
              s.total ?? Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0)
            ),
          }));

          if (rows.length) {
            await LoanSchedule.bulkCreate(rows, { transaction: t });
          }
        }
      } else {
        console.warn("[loans] Skipping schedule generation (model/table missing)");
      }
    }

    if (next === "closed") {
      const outstanding = Number(loan.outstanding ?? 0);
      if (!override && outstanding > 0) {
        await t.rollback();
        return res.status(400).json({ error: "Outstanding > 0, override required" });
      }
      if ((await loanColumnExists("closedBy")) && (await loanUserFkIsCompatible("closedBy"))) {
        fields.closedBy = req.user?.id || null;
      }
      if (await loanColumnExists("closedDate")) {
        fields.closedDate = new Date();
      }
      if (override && (await loanColumnExists("closeReason"))) {
        fields.closeReason = "override";
      }
    }

    // Log what we are about to SET (helps pinpoint missing columns locally)
    try {
      await loan.update(fields, { transaction: t });
    } catch (e) {
      console.error(
        "[loans] loan.update failed with fields=",
        Object.keys(fields).map(k => `${k}→${toDbField(k)}`).join(", "),
        "error:", e?.parent?.code || e?.name, e?.parent?.message || e?.message
      );
      throw e;
    }

    await writeAudit({
      entityId: loan.id,
      action: `status:${next}`,
      before: loan.toJSON(),
      after: loan.toJSON(),
      req,
    });

    await t.commit();

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const updatedLoan = await Loan.findByPk(req.params.id, {
      attributes,
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
        { model: LoanProduct },
        ...userIncludes,
      ],
    });

    res.json({
      message: `Loan ${next} successfully`,
      loan: updatedLoan,
    });
  } catch (err) {
    try { await sequelize.transaction(t => t.rollback?.()); } catch {}
    console.error("Update loan status error:", err);
    res.status(500).json({ error: "Failed to update loan status" });
  }
};

module.exports = {
  createLoan,
  getAllLoans,
  getLoanById,
  updateLoan,
  deleteLoan,
  updateLoanStatus,
  getLoanSchedule,
};
