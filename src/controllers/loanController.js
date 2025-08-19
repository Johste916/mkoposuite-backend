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

const ALLOWED = {
  pending: ["approved", "rejected"],
  approved: ["disbursed"],
  disbursed: ["active", "closed"],
  active: ["closed"],
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

const getLoansTableName = () => {
  const t = Loan.getTableName ? Loan.getTableName() : "loans";
  return typeof t === "string" ? t : t.tableName || "loans";
};

async function getLoanColumns() {
  if (LOAN_COLUMNS_CACHE) return LOAN_COLUMNS_CACHE;
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable(getLoansTableName());
    LOAN_COLUMNS_CACHE = new Set(Object.keys(desc)); // snake_case column names
  } catch (e) {
    // Fallback: infer from model (may still include non-existent columns)
    LOAN_COLUMNS_CACHE = new Set(
      Object.values(Loan.rawAttributes || {}).map(a => a.field || a.fieldName || a)
    );
  }
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

function loanFkField(attrName) {
  // Map a model attribute to the DB field name (snake_case) if defined
  const attr = Loan.rawAttributes?.[attrName];
  return attr?.field || attrName;
}

async function buildUserIncludesIfPossible() {
  const cols = await getLoanColumns();
  const includes = [];
  const mapping = [
    { as: "initiator", attr: "initiatedBy" },
    { as: "approver",  attr: "approvedBy" },
    { as: "rejector",  attr: "rejectedBy" },
    { as: "disburser", attr: "disbursedBy" },
  ];

  for (const m of mapping) {
    const field = loanFkField(m.attr);
    if (field && cols.has(field)) {
      includes.push({ model: User, as: m.as, attributes: ["id", "name"] });
    }
  }
  return includes;
}

/* ===========================
   CREATE LOAN
=========================== */
const createLoan = async (req, res) => {
  try {
    const body = { ...req.body };

    if (body.productId) {
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
      if (body.interestRate == null) body.interestRate = Number(p.interestRate || 0);
    }

    const loan = await Loan.create({
      ...body,
      initiatedBy: req.user?.id || null,
      status: "pending",
    });

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
    if (req.query.status && req.query.status !== "all") where.status = req.query.status;

    const attributes = await getSafeLoanAttributeNames();
    const userIncludes = await buildUserIncludesIfPossible();

    const loans = await Loan.findAll({
      where,
      attributes, // avoid selecting non-existent columns like initiated_by if DB lacks them
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch },            // no custom alias; matches association
        { model: LoanProduct },       // no custom alias; matches association
        ...userIncludes,              // only if the FK column exists in DB
      ],
      order: [["createdAt", "DESC"]],
      limit: 500,
    });

    res.json(loans || []);
  } catch (err) {
    console.error("Fetch loans error:", err);
    res.status(500).json({ error: "Failed to fetch loans" });
  }
};

/* ===========================
   GET LOAN BY ID (+repayments & schedule)
=========================== */
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
        { model: Branch },
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
        order: [["dueDate", "DESC"], ["createdAt", "DESC"]], // use dueDate, not 'date'
      });

      for (const r of repayments) {
        const alloc = r.allocation || [];
        for (const a of alloc) {
          totals.principal += Number(a.principal || 0);
          totals.interest  += Number(a.interest  || 0);
          totals.fees      += Number(a.fees      || 0);
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
    console.error("Get loan by id error:", err);
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
    const loan = await Loan.findByPk(req.params.id, { transaction: t });
    if (!loan) {
      await t.rollback();
      return res.status(404).json({ error: "Loan not found" });
    }

    if (!ALLOWED[loan.status]?.includes(status)) {
      await t.rollback();
      return res.status(400).json({ error: `Cannot change ${loan.status} → ${status}` });
    }

    const before = loan.toJSON();
    const fields = { status };

    if (status === "approved") {
      if ("approvedBy" in Loan.rawAttributes) fields.approvedBy = req.user?.id || null;
      fields.approvalDate = new Date();
    }

    if (status === "disbursed") {
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
            s.total ?? (Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0))
          ),
        }));

        if (rows.length) {
          await LoanSchedule.bulkCreate(rows, { transaction: t });
        }
      }
    }

    if (status === "closed") {
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
      action: `status:${status}`,
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
        { model: Branch },
        { model: LoanProduct },
        ...userIncludes,
      ]
    });

    res.json({
      message: `Loan ${status} successfully`,
      loan: updatedLoan
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
