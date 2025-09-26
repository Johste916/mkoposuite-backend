const {
  Loan,
  Borrower,
  Branch,
  User,
  LoanProduct,
  LoanRepayment,
  LoanSchedule,
  AuditLog,
  sequelize,
} = require("../models");

const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require("../utils/generateSchedule");

const BORROWER_ATTRS = ["id", "name", "nationalId", "phone"];

// NOTE: DB enum usually does NOT contain "active". We treat "active" as *derived* (disbursed & not closed).
const DB_ENUM_STATUSES = new Set(["pending", "approved", "rejected", "disbursed", "closed"]);

// Allowed transitions for the *persisted* enum only
const ALLOWED = {
  pending: ["approved", "rejected"],
  approved: ["disbursed"],
  disbursed: ["closed"], // "active" is derived; do not persist it
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

const getTableNameFromModel = (Model, fallback) => {
  const t = Model?.getTableName ? Model.getTableName() : fallback;
  return typeof t === "string" ? t : t?.tableName || fallback;
};

const getLoansTableName = () => getTableNameFromModel(Loan, "loans");
const getUsersTableName = () => getTableNameFromModel(User, "Users");

function normalizePgType(t = "") {
  const s = String(t).toLowerCase();
  if (s.includes("uuid")) return "uuid";
  if (s.includes("int")) return "int"; // covers int2/int4/int8/bigint/integer
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
    // generic (rarely used here)
    return await qi.describeTable(tableName);
  } catch {
    return null;
  }
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

/** Return list of *model attribute names* whose mapped DB field actually exists */
async function getSafeLoanAttributeNames() {
  const cols = await getLoanColumns();
  const attrs = Loan.rawAttributes || {};
  return Object.keys(attrs).filter((name) => {
    const field = attrs[name]?.field || name;
    return cols.has(field);
  });
}

/**
 * Build includes for the User associations on Loan, but **only** if the FK type
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
    // Determine the FK attribute name on Loan (e.g., 'approvedBy')
    const fkAttrName =
      assoc.foreignKey ||
      assoc.foreignKeyAttribute?.fieldName ||
      assoc.foreignKeyAttribute?.field ||
      null;

    if (!fkAttrName) continue;

    // Map to actual DB field on loans
    const fkDbField =
      Loan.rawAttributes?.[fkAttrName]?.field || fkAttrName;

    // Get FK DB column type
    const fkType = normalizePgType(loansTableDesc?.[fkDbField]?.type || "unknown");

    // Compare with Users PK type
    const compatible =
      (fkType === "uuid" && usersPkType === "uuid") ||
      (fkType === "int" && usersPkType === "int");

    if (!compatible) {
      console.warn(
        `[loans] Skipping include '${as}' due to FK/PK type mismatch: loans.${fkDbField} (${fkType}) vs Users.id (${usersPkType})`
      );
      continue;
    }

    // Safe to include
    includes.push({
      association: assoc, // disambiguates multiple belongsTo(User)
      attributes: ["id", "name"],
      required: false,
    });
  }

  return includes;
}

/* ===========================
   CREATE LOAN
=========================== */
const createLoan = async (req, res) => {
  try {
    // Support both JSON and multipart:
    // - multipart: frontend sends { payload: "<json string>", files..., filesMeta... }
    // - json: frontend sends pure JSON
    const raw = typeof req.body?.payload === "string" ? req.body.payload : null;
    let body = raw ? JSON.parse(raw) : { ...req.body };

    // Map frontend names → model names (no-ops if already correct)
    if (body.durationMonths != null && body.termMonths == null) {
      body.termMonths = Number(body.durationMonths);
    }
    if (body.releaseDate && !body.startDate) {
      body.startDate = body.releaseDate;
    }

    // Coerce numerics
    if (body.amount != null) body.amount = Number(body.amount);
    if (body.termMonths != null) body.termMonths = Number(body.termMonths);
    if (body.interestRate != null && body.interestRate !== "") {
      body.interestRate = Number(body.interestRate);
    }

    // Basic requireds
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

    if (!body.interestMethod) body.interestMethod = p.interestMethod || "flat";
    if (body.interestRate == null || Number.isNaN(body.interestRate)) {
      body.interestRate = Number(p.interestRate || 0);
    }

    // Always start with pending on creation
    body.status = "pending";

    // Only set initiatedBy if the attribute/column exists
    if ("initiatedBy" in (Loan.rawAttributes || {})) {
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

    // NOTE: If you want to persist uploaded files (req.files), handle them here.

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

    // Never pass unknown statuses into an enum column
    const rawStatus = String(req.query.status || "").toLowerCase();
    const scope = String(req.query.scope || "").toLowerCase();

    if (rawStatus && rawStatus !== "all" && DB_ENUM_STATUSES.has(rawStatus)) {
      // safe to pass to DB
      where.status = rawStatus;
    }
    // If rawStatus === "active" or any other derived, we DO NOT add to where;
    // we'll filter in-memory below.

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const loans = await Loan.findAll({
      where,
      attributes, // avoid selecting non-existent columns
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        // include branch with new phone/address fields
        { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
        { model: LoanProduct },
        ...userIncludes, // only type-safe user includes
      ],
      order: [["createdAt", "DESC"]],
      limit: 500,
    });

    // Derived lists (client or "scope" based)
    let result = loans;

    // Treat "active" as disbursed & not closed (best-effort; usually just "disbursed")
    if (rawStatus === "active" || scope === "active") {
      result = result.filter(
        (l) => String(l.status || "").toLowerCase() === "disbursed"
      );
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
      repayments = await LoanRepayment.findAll({
        where: { loanId: loan.id },
        order: [["date", "DESC"], ["createdAt", "DESC"]],
      });

      for (const r of repayments) {
        const alloc = r.allocation || [];
        for (const a of alloc) {
          totals.principal += Number(a.principal || 0);
          totals.interest += Number(a.interest || 0);
          totals.fees += Number(a.fees || 0);
          totals.penalties += Number(a.penalties || 0);
        }
        totals.totalPaid += Number(r.amount || r.total || 0);
      }

      totals.outstanding = Math.max(
        0,
        Number(loan.amount || 0) + Number(loan.totalInterest || 0) - totals.totalPaid
      );
    }

    let schedule = [];
    if (includeSchedule === "true") {
      schedule = await LoanSchedule.findAll({
        where: { loanId: loan.id },
        order: [["period", "ASC"]],
      });
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

    const loan = await Loan.findByPk(req.params.id, { transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    if (!ALLOWED[loan.status]?.includes(next)) {
      await t.rollback();
      return res.status(400).json({ error: `Cannot change ${loan.status} → ${next}` });
    }

    const before = loan.toJSON();
    const fields = { status: next };

    if (next === "approved") {
      if ("approvedBy" in Loan.rawAttributes) fields.approvedBy = req.user?.id || null;
      fields.approvalDate = new Date();
    }

    if (next === "disbursed") {
      if ("disbursedBy" in Loan.rawAttributes) fields.disbursedBy = req.user?.id || null;
      fields.disbursementDate = new Date();

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
            s.total ??
              Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0)
          ),
        }));

        if (rows.length) {
          await LoanSchedule.bulkCreate(rows, { transaction: t });
        }
      }
    }

    if (next === "closed") {
      const outstanding = Number(loan.outstanding ?? 0);
      if (!override && outstanding > 0) {
        await t.rollback();
        return res.status(400).json({ error: "Outstanding > 0, override required" });
      }
      if ("closedBy" in Loan.rawAttributes) fields.closedBy = req.user?.id || null;
      fields.closedDate = new Date();
      if (override) fields.closeReason = "override";
    }

    await loan.update(fields, { transaction: t });

    await writeAudit({
      entityId: loan.id,
      action: `status:${next}`,
      before,
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
    await t.rollback();
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
