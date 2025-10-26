// controllers/loans.js
const {
  Loan,
  Borrower,
  Branch,
  User,
  LoanProduct,
  LoanRepayment,   // keep existing import to avoid breaking other parts
  LoanPayment,     // explicit to avoid undefined
  LoanSchedule,
  AuditLog,
  sequelize,
} = require("../models");

const { Op, where, col } = require("sequelize");
/* ---------- soft deps: event bus + aggregates (both optional) ---------- */
let BUS = null, EVENTS = null;
try { ({ bus: BUS, EVENTS } = require('../services/syncBus')); } catch {}

const emitSafe = (evt, payload) => {
  try {
    if (BUS?.emitSafe) BUS.emitSafe(evt, payload);
    else if (BUS?.emit) BUS.emit(evt, payload);
  } catch {}
};

let Aggregates = {
  recomputeLoanAggregates: async () => {},
  recomputeBorrowerAggregates: async () => {},
  recomputeLoanAndBorrower: async () => {},
};
try { Aggregates = require('../services/aggregates'); } catch {}

const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require("../utils/generateSchedule");

const BORROWER_ATTRS = ["id", "name", "nationalId", "phone"];

// DB statuses (persisted). "active" is derived (disbursed & not closed) and is not persisted.
const DB_ENUM_STATUSES = new Set(["pending", "approved", "rejected", "disbursed", "closed"]);

// Allowed transitions for the persisted enum only
// NOTE: expanded to allow resubmission after rejection (rejected -> pending)
const ALLOWED = {
  pending:   ["approved", "rejected"],
  approved:  ["disbursed", "rejected"], // allow explicit reversal to rejected if needed
  rejected:  ["pending"],
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

// enum cache
const ENUM_CACHE = Object.create(null);

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
  if (s.includes("enum") || s.includes("user-defined")) return "enum";
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

/** Return type + allowNull meta for loans.<attr> */
async function getLoanColumnMeta(attr) {
  const loansDesc = await describeTableCached(getLoansTableName());
  const dbField = Loan?.rawAttributes?.[attr]?.field || attr;
  const col = loansDesc?.[dbField] || null;
  if (!col) return null;
  return {
    type: normalizePgType(col.type || "unknown"),
    allowNull: !!col.allowNull,
    raw: col,
    dbField,
  };
}

/** Prefer model-defined enum values; otherwise pull them robustly from the DB */
async function getEnumLabelsForColumn(tableName, columnName) {
  try {
    // 1) Model-defined enum (most reliable)
    if (Loan && columnName === "status") {
      const ra = Loan.rawAttributes?.status;
      const modelVals =
        (ra && (ra.values || ra.type?.values)) ? (ra.values || ra.type.values) : null;
      if (Array.isArray(modelVals) && modelVals.length) return modelVals;
    }

    // 2) Cached?
    const key = `${String(tableName).toLowerCase()}.${String(columnName).toLowerCase()}`;
    if (ENUM_CACHE[key]) return ENUM_CACHE[key];

    // 3) Two-step DB lookup: first get udt_name, then fetch pg_enum labels
    const [[udtRow]] = await sequelize.query(
      `
      SELECT c.udt_name
      FROM information_schema.columns c
      WHERE lower(c.table_schema) = lower(current_schema())
        AND lower(c.table_name) = lower(:tableName)
        AND lower(c.column_name) = lower(:columnName)
      `,
      { replacements: { tableName, columnName } }
    );

    const udt = udtRow?.udt_name;
    if (!udt) {
      ENUM_CACHE[key] = [];
      return [];
    }

    const [rows] = await sequelize.query(
      `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = :udt
      ORDER BY e.enumsortorder
      `,
      { replacements: { udt } }
    );
    const labels = Array.isArray(rows) ? rows.map(r => r.enumlabel) : [];
    ENUM_CACHE[key] = labels;
    return labels;
  } catch (e) {
    console.warn("[loans] enum introspection failed:", e.message);
    return [];
  }
}

/** Map a friendly status ('approved') to the exact DB enum label (e.g., 'Approved') */
async function mapStatusToDbEnumLabel(next) {
  const table = getLoansTableName();
  const labels = await getEnumLabelsForColumn(table, "status");
  if (!labels.length) return next; // column not enum (or unknown) → pass through
  const hit = labels.find(l => String(l).toLowerCase() === String(next).toLowerCase());
  return hit || null;
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

/** Safely set a User FK into fields, coercing to int/validating uuid as needed */
async function setUserFkIfSafe(fields, attr, userId) {
  if (!(await loanColumnExists(attr))) return;
  const meta = await getLoanColumnMeta(attr);
  if (!meta) return;
  if (meta.type === "int") {
    const asInt = Number.parseInt(userId, 10);
    if (Number.isFinite(asInt)) fields[attr] = asInt;
    else console.warn(`[loans] Skip ${attr}: userId not numeric for int FK`);
  } else if (meta.type === "uuid") {
    const s = String(userId || "");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
      fields[attr] = s;
    } else {
      console.warn(`[loans] Skip ${attr}: userId not a UUID for uuid FK`);
    }
  } else {
    // unknown or text → do nothing; we don't know safe casting
    console.warn(`[loans] Skip ${attr}: unsupported FK column type ${meta.type}`);
  }
}

/** Safely set a date/timestamp column */
async function setDateCol(fields, attr, dateVal = new Date()) {
  if (!(await loanColumnExists(attr))) return;
  const meta = await getLoanColumnMeta(attr);
  if (!meta) return;
  if (meta.type === "date") {
    fields[attr] = new Date(dateVal).toISOString().slice(0, 10); // YYYY-MM-DD
  } else {
    fields[attr] = dateVal; // Sequelize handles timestamp
  }
}

/** Preflight: ensure we *can* set required columns for a transition */
async function preflightTransition(next, userId) {
  // 1) status column cannot be INT
  const statusMeta = await getLoanColumnMeta("status");
  if (statusMeta && statusMeta.type === "int") {
    return `Cannot set string status "${next}" because loans.status is numeric (int).`;
  }
  // 1b) if enum, make sure value exists
  if (statusMeta && statusMeta.type === "enum") {
    const mapped = await mapStatusToDbEnumLabel(next);
    if (!mapped) {
      const labels = await getEnumLabelsForColumn(getLoansTableName(), "status");
      return `Status "${next}" not supported by DB enum. Allowed: ${labels.join(", ")}`;
    }
  }

  // helper to check a FK requirement
  const needUserFk = async (attrName, label) => {
    const meta = await getLoanColumnMeta(attrName);
    if (!meta) return null; // column absent → nothing to validate
    if (meta.allowNull) return null; // nullable → not strictly required
    // Non-nullable: must be coercible
    if (meta.type === "int") {
      const asInt = Number.parseInt(userId, 10);
      if (!Number.isFinite(asInt)) {
        return `Cannot ${label}: ${attrName} is INT NOT NULL but current user id is not numeric.`;
      }
    } else if (meta.type === "uuid") {
      const s = String(userId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
        return `Cannot ${label}: ${attrName} is UUID NOT NULL but current user id is not a UUID.`;
      }
    } else {
      return null;
    }
    return null;
  };

  const needDateCol = async (attrName) => {
    const meta = await getLoanColumnMeta(attrName);
    if (!meta) return null;
    if (meta.allowNull) return null;
    return null; // we will set a value
  };

  if (next === "approved") {
    return (
      (await needUserFk("approvedBy", "approve")) ||
      (await needDateCol("approvalDate")) ||
      null
    );
  }
  if (next === "rejected") {
    return (
      (await needUserFk("rejectedBy", "reject")) ||
      (await needDateCol("rejectedDate")) ||
      null
    );
  }
  if (next === "disbursed") {
    return (
      (await needUserFk("disbursedBy", "disburse")) ||
      (await needDateCol("disbursementDate")) ||
      null
    );
  }
  if (next === "closed") {
    return (
      (await needUserFk("closedBy", "close")) ||
      (await needDateCol("closedDate")) ||
      null
    );
  }
  return null;
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
   Small helpers
=========================== */
const csvEscape = (v) => {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

async function hasAnyRepayments(loanId) {
  const RepaymentModel =
    LoanPayment ||
    LoanRepayment ||
    (sequelize.models && (sequelize.models.LoanPayment || sequelize.models.LoanRepayment));

  if (!RepaymentModel || typeof RepaymentModel.count !== "function") return false;
  try {
    const n = await RepaymentModel.count({ where: { loanId } });
    return n > 0;
  } catch {
    return false;
  }
}

async function getScheduleTableColumns() {
  const desc = await describeTableCached("loan_schedules");
  return desc ? new Set(Object.keys(desc)) : new Set();
}

/** Safe schedule attribute names (model attr whose DB field exists) */
async function getSafeScheduleAttributeNames() {
  const desc = await describeTableCached("loan_schedules");
  const cols = new Set(desc ? Object.keys(desc) : []);
  const attrs = LoanSchedule?.rawAttributes || {};
  return Object.keys(attrs).filter((name) => {
    const field = attrs[name]?.field || name;
    return cols.has(field);
  });
}

/** DRY: shape a schedule row so only existing DB fields are sent (handles field mapping) */
async function shapeScheduleRowForDb(base) {
  const cols = await getScheduleTableColumns(); // DB columns (field names)
  const attrs = LoanSchedule?.rawAttributes || {};
  return Object.fromEntries(
    Object.entries(base).filter(([attrKey]) => {
      const field = attrs[attrKey]?.field || attrKey; // map attr -> field
      return cols.has(field);
    })
  );
}

/** Build a safe WHERE for loan schedules across snake/camel column names */
function scheduleLoanIdWhere(val) {
  if (LoanSchedule?.rawAttributes?.loanId) {
    // Sequelize will map loanId -> loan_id if needed
    return { loanId: val };
  }
  // Fallback to raw SQL column with explicit operator
  return where(col("loan_schedules.loan_id"), Op.eq, val);
}

/** Bulk insert only provided fields (prevents Sequelize from trying to write non-existent columns) */
async function bulkCreateLoanSchedulesSafe(rows) {
  if (!rows?.length) return;
  const fields = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  await LoanSchedule.bulkCreate(rows, { fields, validate: false });
}

/** DRY: safely fetch a loan by PK without selecting missing columns */
async function fetchLoanByPkSafe(id) {
  const attributes = await getSafeLoanAttributeNames();
  const userIncludes = await buildUserIncludesIfPossible();
  return Loan.findByPk(id, {
    attributes,
    include: [
      { model: Borrower, attributes: BORROWER_ATTRS },
      { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
      { model: LoanProduct },
      ...userIncludes,
    ],
  });
}

/* ====================================================================
   CORE: Transition executor usable by multiple endpoints (DRY)
==================================================================== */
async function performStatusTransition(loan, next, { override = false, req }) {
  if (!ALLOWED[loan.status]?.includes(next)) {
    const err = new Error(`Cannot change ${loan.status} → ${next}`);
    err.http = 400;
    throw err;
  }

  // Preflight avoid FK/type errors
  const preMsg = await preflightTransition(next, req?.user?.id || null);
  if (preMsg) {
    const err = new Error(preMsg);
    err.http = 400;
    throw err;
  }

  if (next === "closed") {
    const outstanding = Number(loan.outstanding ?? 0);
    if (!override && outstanding > 0) {
      const err = new Error("Outstanding > 0, override required");
      err.http = 400;
      throw err;
    }
  }

  const mappedStatus = await mapStatusToDbEnumLabel(next);
  if (!mappedStatus) {
    const labels = await getEnumLabelsForColumn(getLoansTableName(), "status");
    const err = new Error(`Status "${next}" not supported by DB enum. Allowed: ${labels.join(", ")}`);
    err.http = 400;
    throw err;
  }

  const fields = {};
  if (await loanColumnExists("status")) fields.status = mappedStatus;
  else {
    const err = new Error("loans.status column missing");
    err.http = 500;
    throw err;
  }

  if (next === "approved") {
    await setUserFkIfSafe(fields, "approvedBy", req?.user?.id || null);
    await setDateCol(fields, "approvalDate", new Date());
  }
  if (next === "rejected") {
    await setUserFkIfSafe(fields, "rejectedBy", req?.user?.id || null);
    await setDateCol(fields, "rejectedDate", new Date());
  }
  if (next === "disbursed") {
    await setUserFkIfSafe(fields, "disbursedBy", req?.user?.id || null);
    await setDateCol(fields, "disbursementDate", new Date());
  }
  if (next === "closed") {
    await setUserFkIfSafe(fields, "closedBy", req?.user?.id || null);
    await setDateCol(fields, "closedDate", new Date());
    if (override && (await loanColumnExists("closeReason"))) {
      fields.closeReason = "override";
    }
  }

  try {
    await loan.update(fields);
  } catch (e) {
    const err = new Error(e?.parent?.message || e?.message || "Status update failed");
    err.http = 400;
    err.meta = {
      fields,
      code: e?.parent?.code || e?.original?.code,
      detail: e?.parent?.detail || null,
    };
    throw err;
  }

  // For first disbursement, auto-create schedule if table exists and none present
  if (next === "disbursed" && LoanSchedule && (await tableExists("loan_schedules"))) {
    try {
      const existing = await LoanSchedule.count({ where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] } });
      if (existing === 0) {
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
        if (gen.length) {
          const rows = [];
          for (let i = 0; i < gen.length; i++) {
            const s = gen[i];
            const base = {
              loanId: loan.id,
              period: i + 1,
              dueDate: s.dueDate,
              principal: Number(s.principal || 0),
              interest: Number(s.interest || 0),
              fees: Number(s.fees || 0),
              penalties: Number(s.penalties || 0),
              total:
                Number(
                  s.total ??
                    Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0) + Number(s.penalties || 0)
                ),
            };
            rows.push(await shapeScheduleRowForDb(base));
          }
          await bulkCreateLoanSchedulesSafe(rows);
        }
      }
    } catch (e) {
      console.warn("[loans] schedule generation failed (non-fatal):", e?.parent?.message || e?.message);
    }
  }

  // Return hydrated record with associations (safe attrs)
  const updatedLoan = await fetchLoanByPkSafe(loan.id);
  return updatedLoan;
}

/* ===========================
   CREATE LOAN
=========================== */
const createLoan = async (req, res) => {
  try {
    const raw = typeof req.body?.payload === "string" ? req.body.payload : null;
    let body = raw ? JSON.parse(raw) : { ...req.body };

    // Name normalization
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

    // Persisted status starts as pending → map to DB enum label if needed
    const pendingLabel = await mapStatusToDbEnumLabel("pending");
    body.status = pendingLabel || "pending";

    // initiatedBy only if present and column exists
    if ("initiatedBy" in (Loan.rawAttributes || {}) && (await loanColumnExists("initiatedBy"))) {
      await setUserFkIfSafe(body, "initiatedBy", req.user?.id || null);
    }

    const loan = await Loan.create(body);

    writeAudit({
      entityId: loan.id,
      action: "create",
      before: null,
      after: loan.toJSON(),
      req,
    }).catch(() => {});

    // Reload with safe attributes to avoid selecting missing columns
    const reloaded = await fetchLoanByPkSafe(loan.id);
    res.status(201).json(reloaded || loan);
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
    const whereObj = {};

    const rawStatus = String(req.query.status || "").toLowerCase();
    const scope = String(req.query.scope || "").toLowerCase();

    if (rawStatus && rawStatus !== "all" && DB_ENUM_STATUSES.has(rawStatus)) {
      const mapped = await mapStatusToDbEnumLabel(rawStatus);
      whereObj.status = mapped || rawStatus;
    }

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const loans = await Loan.findAll({
      where: whereObj,
      attributes,
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, attributes: ["id", "name", "code", "phone", "address"] },
        { model: LoanProduct },
        ...userIncludes,
      ],
      // Keeping as-is to avoid touching Loans ordering if it's already working for you.
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
    // Guard: only allow numeric IDs here so /loans/disbursed never reaches the DB as an id
    const idRaw = String(req.params.id ?? '');
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Loan id must be an integer', received: idRaw });
    }

    const { includeRepayments = "true", includeSchedule = "true" } = req.query;

    const loan = await fetchLoanByPkSafe(id);
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
      const RepaymentModel =
        LoanPayment ||
        LoanRepayment ||
        (sequelize.models && (sequelize.models.LoanPayment || sequelize.models.LoanRepayment));

      if (!RepaymentModel || typeof RepaymentModel.findAll !== "function") {
        console.warn("[loans] No repayment model registered; returning empty repayments list");
      } else {
        // Build a safe order: prefer paymentDate/date if present, always fall back to created_at
        const attrs = RepaymentModel.rawAttributes || {};
        const orderParts = [];
        if (attrs.paymentDate) orderParts.push(['paymentDate', 'DESC']);
        else if (attrs.date) orderParts.push(['date', 'DESC']);
        orderParts.push(['created_at', 'DESC']); // DB column exists; avoid 'createdAt'

        repayments = await RepaymentModel.findAll({
          where: { loanId: loan.id },
          order: orderParts,
        });

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
          const scheduleAttrs = await getSafeScheduleAttributeNames();
          schedule = await LoanSchedule.findAll({
            where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] },
            attributes: scheduleAttrs,
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
    const loan = await fetchLoanByPkSafe(req.params.id);
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

    writeAudit({
      entityId: loan.id,
      action: "update",
      before,
      after: loan.toJSON(),
      req,
    }).catch(() => {});

    // Reload with safe attributes
    const reloaded = await fetchLoanByPkSafe(loan.id);
    res.json(reloaded || loan);
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
    const loan = await fetchLoanByPkSafe(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const before = loan.toJSON();
    await loan.destroy();

    writeAudit({
      entityId: loan.id,
      action: "delete",
      before,
      after: null,
      req,
    }).catch(() => {});

    res.json({ message: "Loan deleted" });
  } catch (err) {
    console.error("Delete loan error:", err);
    res.status(500).json({ error: "Error deleting loan" });
  }
};

/* ===========================
   GENERATE SCHEDULE (Preview)
=========================== */
/* ===========================
   GET LOAN SCHEDULE (prefer DB; fallback to preview)
=========================== */
const getLoanSchedule = async (req, res) => {
  try {
    const loanId = req.params.loanId || req.params.id;
    const loan = await fetchLoanByPkSafe(loanId);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    // 1) Prefer persisted rows (so we return paid*, balance, settled, etc.)
    let rows = [];
    if (LoanSchedule && (await tableExists("loan_schedules"))) {
      try {
        const scheduleAttrs = await getSafeScheduleAttributeNames();
        rows = await LoanSchedule.findAll({
          where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] },
          attributes: scheduleAttrs,
          order: [["period", "ASC"]],
        });
      } catch (e) {
        console.warn(`[loans] getLoanSchedule DB fetch failed: ${e.message}`);
      }
    }

    if (rows && rows.length) {
      return res.json(rows);
    }

    // 2) Fallback to generated preview (first-time / no table)
    const schedule =
      loan.interestMethod === "flat"
        ? generateFlatRateSchedule({
            amount: Number(loan.amount || 0),
            interestRate: Number(loan.interestRate || 0),
            term: loan.termMonths,
            issueDate: loan.startDate,
          })
        : loan.interestMethod === "reducing"
        ? generateReducingBalanceSchedule({
            amount: Number(loan.amount || 0),
            interestRate: Number(loan.interestRate || 0),
            term: loan.termMonths,
            issueDate: loan.startDate,
          })
        : [];

    if (!schedule.length) return res.status(400).json({ error: "Invalid interest method" });
    return res.json(schedule);
  } catch (err) {
    console.error("Get schedule error:", err);
    res.status(500).json({ error: "Failed to get schedule" });
  }
};


/* ===========================
   RESCHEDULE (replace or preview)
=========================== */
const rebuildLoanSchedule = async (req, res) => {
  try {
    const id = req.params.loanId || req.params.id;
    const loan = await fetchLoanByPkSafe(id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const {
      mode = "preview",
      startDate,
      termMonths,
      amount,
      interestRate,
      interestMethod,
      preservePaid = true,
    } = req.body || {};

    const effective = {
      startDate: startDate || loan.startDate,
      termMonths: Number.isFinite(Number(termMonths)) ? Number(termMonths) : loan.termMonths,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : Number(loan.amount || 0),
      interestRate:
        Number.isFinite(Number(interestRate)) ? Number(interestRate) : Number(loan.interestRate || 0),
      interestMethod: interestMethod || loan.interestMethod || "flat",
    };

    // Generate schedule with proposed/updated values
    const schedule =
      effective.interestMethod === "flat"
        ? generateFlatRateSchedule({
            amount: effective.amount,
            interestRate: effective.interestRate,
            term: effective.termMonths,
            issueDate: effective.startDate,
          })
        : effective.interestMethod === "reducing"
        ? generateReducingBalanceSchedule({
            amount: effective.amount,
            interestRate: effective.interestRate,
            term: effective.termMonths,
            issueDate: effective.startDate,
          })
        : [];

    if (!schedule.length) {
      return res.status(400).json({ error: "Invalid interest method" });
    }

    if (mode === "preview") {
      return res.json({ mode, schedule });
    }

    // mode === "replace": persist by replacing existing rows
    if (!(await tableExists("loan_schedules"))) {
      return res.status(400).json({ error: "loan_schedules table not found" });
    }

    // Fetch existing rows if preserving paid/settled flags
    let existing = [];
    if (preservePaid) {
      const scheduleAttrs = await getSafeScheduleAttributeNames();
      existing = await LoanSchedule.findAll({
        where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] },
        attributes: scheduleAttrs,
        order: [["period", "ASC"]],
      });
    }

    await LoanSchedule.destroy({ where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] } });

    const rows = [];
    for (let i = 0; i < schedule.length; i++) {
      const s = schedule[i];
      const base = {
        loanId: loan.id,
        period: i + 1,
        dueDate: s.dueDate,
        principal: Number(s.principal || 0),
        interest: Number(s.interest || 0),
        fees: Number(s.fees || 0),
        penalties: Number(s.penalties || 0),
        total:
          Number(
            s.total ??
              Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0) + Number(s.penalties || 0)
          ),
      };

      // carry over 'paid/settled' flags by index if requested and present
      if (preservePaid && existing[i]) {
        if ("paid" in existing[i]) base.paid = existing[i].paid;
        if ("settled" in existing[i]) base.settled = existing[i].settled;
        if ("balance" in existing[i] && !Number.isFinite(base.balance)) base.balance = existing[i].balance;
      }

      rows.push(await shapeScheduleRowForDb(base));
    }

    await bulkCreateLoanSchedulesSafe(rows);

    // Optionally align loan.startDate/endDate if caller changed them
    const updates = {};
    if (startDate && (await loanColumnExists("startDate"))) updates.startDate = effective.startDate;
    if ((termMonths || startDate) && (await loanColumnExists("endDate"))) {
      updates.endDate = addMonthsDateOnly(effective.startDate, effective.termMonths);
    }
    if (Object.keys(updates).length) await loan.update(updates);

    writeAudit({
      entityId: loan.id,
      action: "schedule:rebuild",
      before: null,
      after: { startDate: loan.startDate, endDate: loan.endDate, rows: rows.length },
      req,
    }).catch(() => {});

    return res.json({ mode: "replace", count: rows.length });
  } catch (err) {
    console.error("Reschedule error:", err);
    // expose helpful details to the client for debugging
    return res.status(500).json({
      error: "Failed to rebuild schedule",
      detail: err?.parent?.message || err?.message || null,
      code: err?.parent?.code || err?.code || null,
      sql: err?.sql || null,
    });
  }
};

/* ===========================
   UI alias: /loans/:id/reschedule  → rebuildLoanSchedule
=========================== */
const rescheduleLoan = async (req, res) => {
  try {
    const {
      newTermMonths,
      newStartDate,
      previewOnly,
      termMonths,
      startDate,
      amount,
      interestRate,
      interestMethod,
      preservePaid,
      preview,
    } = req.body || {};

    req.body = {
      mode: (previewOnly || preview) ? "preview" : "replace",
      termMonths: newTermMonths ?? termMonths,
      startDate: newStartDate || startDate,
      amount,
      interestRate,
      interestMethod,
      preservePaid: typeof preservePaid === "boolean" ? preservePaid : true,
    };

    return rebuildLoanSchedule(req, res);
  } catch (err) {
    console.error("rescheduleLoan error:", err);
    return res.status(500).json({ error: "Failed to reschedule loan" });
  }
};

/* ===========================
   CSV EXPORT of schedule
=========================== */
const exportLoanScheduleCsv = async (req, res) => {
  try {
    const id = req.params.loanId || req.params.id;
    const loan = await fetchLoanByPkSafe(id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    let rows = [];
    if (LoanSchedule && (await tableExists("loan_schedules"))) {
      const scheduleAttrs = await getSafeScheduleAttributeNames();
      rows = await LoanSchedule.findAll({
        where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] },
        attributes: scheduleAttrs,
        order: [["period", "ASC"]],
      });
    }

    // Fallback: generate preview rows if table empty
    if (!rows.length) {
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
      rows = gen.map((s, i) => ({
        period: i + 1,
        dueDate: s.dueDate,
        principal: s.principal,
        interest: s.interest,
        penalties: s.penalties || 0,
        fees: s.fees || 0,
        total:
          s.total ??
          Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0) + Number(s.penalties || 0),
        balance: s.balance ?? "",
        settled: s.settled ?? false,
      }));
    }

    const header = [
      "Period",
      "Due Date",
      "Principal",
      "Interest",
      "Penalties",
      "Fees",
      "Total",
      "Balance",
      "Status",
    ];

    const lines = [header.map(csvEscape).join(",")];
    for (const r of rows) {
      const settled = r.settled || r.paid ? "Settled" : "Pending";
      lines.push(
        [
          r.period,
          r.dueDate,
          r.principal ?? 0,
          r.interest ?? 0,
          r.penalties ?? r.penalty ?? 0,
          r.fees ?? r.fee ?? 0,
          r.total ??
            Number(r.principal || 0) + Number(r.interest || 0) + Number(r.fees || 0) + Number(r.penalties || 0),
          r.balance ?? "",
          settled,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="loan-${loan.id}-schedule.csv"`);
    res.status(200).send(lines.join("\n"));
  } catch (err) {
    console.error("Export CSV error:", err);
    res.status(500).json({ error: "Failed to export schedule CSV" });
  }
};

/* ===========================
   STATUS UPDATE (single UPDATE)
=========================== */
const updateLoanStatus = async (req, res) => {
  try {
    const next = String(req.body?.status || "").toLowerCase();
    const override = !!req.body?.override;

    const loan = await fetchLoanByPkSafe(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const updatedLoan = await performStatusTransition(loan, next, { override, req });

    writeAudit({
      entityId: loan.id,
      action: `status:${next}`,
      before: null,
      after: updatedLoan?.toJSON?.() || null,
      req,
    }).catch(() => {});

    res.json({ message: `Loan ${next} successfully`, loan: updatedLoan });
  } catch (err) {
    const code = err.http || 500;
    const payload = { error: err.message };
    if (err.meta) Object.assign(payload, err.meta);
    res.status(code).json(payload);
  }
};

/* ===========================
   WORKFLOW ACTION (optional)
=========================== */
const workflowAction = async (req, res) => {
  try {
    const id = req.params.id;
    const { action, suggestedAmount } = req.body || {};
    const loan = await fetchLoanByPkSafe(id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    // If approver provided a suggestion, update amount first (non-blocking if identical)
    if (suggestedAmount != null && Number(suggestedAmount) > 0) {
      await loan.update({ amount: Number(suggestedAmount) });
    }

    if (action === "bm_approve" || action === "compliance_approve") {
      const updated = await performStatusTransition(loan, "approved", { req });
      return res.json({ message: "Approved", loan: updated });
    }

    if (action === "reject") {
      const updated = await performStatusTransition(loan, "rejected", { req });
      return res.json({ message: "Rejected", loan: updated });
    }

    if (action === "resubmit") {
      // Allow resubmitting a rejected app back to pending
      if (!ALLOWED[loan.status]?.includes("pending")) {
        return res.status(400).json({ error: `Cannot change ${loan.status} → pending` });
      }
      const updated = await performStatusTransition(loan, "pending", { req });
      return res.json({ message: "Resubmitted", loan: updated });
    }

    if (action === "request_changes") {
      // No status change here; comments endpoint handles the note.
      return res.json({ message: "Change request recorded" });
    }

    return res.status(400).json({ error: "Unknown workflow action" });
  } catch (err) {
    console.error("Workflow action error:", err);
    res.status(500).json({ error: "Failed to apply workflow action" });
  }
};

/* ===========================
   RE-ISSUE DISBURSEMENT (optional)
=========================== */
const reissueLoan = async (req, res) => {
  try {
    const id = req.params.id;
    const loan = await fetchLoanByPkSafe(id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    if (await hasAnyRepayments(loan.id)) {
      return res.status(400).json({ error: "Cannot re-issue: repayments already recorded" });
    }

    const {
      disbursementDate = new Date().toISOString(),
      startDate = disbursementDate.slice(0, 10),
      regenerateSchedule = true,
    } = req.body || {};

    // Update date fields if present in DB
    const updates = {};
    if (await loanColumnExists("disbursementDate")) updates.disbursementDate = disbursementDate;
    if (await loanColumnExists("startDate")) updates.startDate = startDate;
    if (await loanColumnExists("endDate")) {
      updates.endDate = addMonthsDateOnly(startDate, loan.termMonths);
    }

    // Keep status as 'disbursed' (or transition from approved → disbursed if needed)
    if (loan.status === "approved") {
      await performStatusTransition(loan, "disbursed", { req });
    }

    await loan.update(updates);

    // Regenerate schedule from new dates
    if (regenerateSchedule && (await tableExists("loan_schedules"))) {
      await LoanSchedule.destroy({ where: { [Op.and]: [scheduleLoanIdWhere(loan.id)] } });

      const input = {
        amount: Number(loan.amount || 0),
        interestRate: Number(loan.interestRate || 0),
        term: loan.termMonths,
        issueDate: startDate,
      };
      const gen =
        loan.interestMethod === "flat"
          ? generateFlatRateSchedule(input)
          : loan.interestMethod === "reducing"
          ? generateReducingBalanceSchedule(input)
          : [];

      const rows = [];
      for (let i = 0; i < gen.length; i++) {
        const s = gen[i];
        const base = {
          loanId: loan.id,
          period: i + 1,
          dueDate: s.dueDate,
          principal: Number(s.principal || 0),
          interest: Number(s.interest || 0),
          fees: Number(s.fees || 0),
          penalties: Number(s.penalties || 0),
          total:
            Number(
              s.total ??
                Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0) + Number(s.penalties || 0)
            ),
        };
        rows.push(await shapeScheduleRowForDb(base));
      }
      if (rows.length) await bulkCreateLoanSchedulesSafe(rows);
    }

    writeAudit({
      entityId: loan.id,
      action: "reissue",
      before: null,
      after: { ...updates },
      req,
    }).catch(() => {});

    const reloaded = await fetchLoanByPkSafe(loan.id);
    res.json({ message: "Loan re-issued", loan: reloaded || loan });
  } catch (err) {
    console.error("Re-issue error:", err);
    res.status(500).json({ error: "Failed to re-issue loan" });
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

  // NEW/optional, wire routes if you want these features:
  workflowAction,          // POST /loans/:id/workflow
  rebuildLoanSchedule,     // POST /loans/:id/schedule
  exportLoanScheduleCsv,   // GET  /loans/:id/schedule/export.csv
  reissueLoan,             // POST /loans/:id/reissue

  // UI alias expected by the frontend
  rescheduleLoan,          // POST /loans/:id/reschedule
};
