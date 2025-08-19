// backend/src/controllers/loanController.js
"use strict";

/**
 * Hardened Loan controller:
 * - Uses association introspection to include relations only when present.
 * - Uses correct alias for Branch if defined (commonly 'Branch'); otherwise no alias.
 * - Orders by createdAt with fallback to raw createdAt/created_at.
 * - Uses LoanRepayment.dueDate (not 'date') and tolerates missing fields (amount/allocations).
 * - Defensive audit logging (optional AuditLog model).
 */

const models = require("../models");
const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require("../utils/generateSchedule");

const sequelize = models.sequelize;

// Prefer grabbing models from the registry so missing ones don't crash
const Loan           = models.Loan || null;
const Borrower       = models.Borrower || null;
const Branch         = models.Branch || null;
const User           = models.User || null;
const LoanProduct    = models.LoanProduct || null;
const LoanRepayment  = models.LoanRepayment || null;
const LoanSchedule   = models.LoanSchedule || null;
const AuditLog       = models.AuditLog || null;

const BORROWER_ATTRS = ["id", "name", "nationalId", "phone"];

// Allowed status transitions
const ALLOWED = {
  pending:   ["approved", "rejected"],
  approved:  ["disbursed"],
  disbursed: ["active", "closed"],
  active:    ["closed"],
};

/* -------------------------------- helpers -------------------------------- */

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

// Try to order by createdAt, then raw createdAt, then created_at
function buildCreatedOrder(Model, direction = "DESC") {
  const items = [];
  // attribute if it exists
  items.push(["createdAt", direction]);
  // raw camel
  items.push([sequelize.literal(`"${Model?.name || "Loan"}"."createdAt"`), direction]);
  // raw snake
  items.push([sequelize.literal(`"${Model?.name || "Loan"}"."created_at"`), direction]);
  return items;
}

// Build safe include array using existing associations only
function buildLoanIncludes() {
  if (!Loan) return [];

  const assoc = Loan.associations || {};
  const inc = [];

  if (Borrower && (assoc.Borrower || assoc.borrower)) {
    inc.push({ model: Borrower, attributes: BORROWER_ATTRS });
  } else if (Borrower) {
    // no alias specified in association — Sequelize's default is the Model name
    inc.push({ model: Borrower, attributes: BORROWER_ATTRS });
  }

  if (Branch && assoc.Branch) {
    inc.push({ model: Branch, as: "Branch" }); // ✅ alias present
  } else if (Branch && !assoc.Branch && !assoc.branch) {
    // If association had no alias, include without 'as'
    inc.push({ model: Branch });
  } else if (Branch && assoc.branch) {
    // Uncommon, but support lower-case alias if it exists
    inc.push({ model: Branch, as: "branch" });
  }

  // LoanProduct — prefer whatever alias was registered
  if (LoanProduct) {
    if (assoc.LoanProduct) inc.push({ model: LoanProduct });           // no alias used at define-time
    else if (assoc.product) inc.push({ model: LoanProduct, as: "product" });
    else if (assoc.loanProduct) inc.push({ model: LoanProduct, as: "loanProduct" });
    else inc.push({ model: LoanProduct }); // safest fallback
  }

  // Optional User relations if your Loan model defined them
  if (User) {
    if (assoc.initiator) inc.push({ model: User, as: "initiator", attributes: ["id", "name", "email"] });
    if (assoc.approver)  inc.push({ model: User, as: "approver",  attributes: ["id", "name", "email"] });
    if (assoc.rejector)  inc.push({ model: User, as: "rejector",  attributes: ["id", "name", "email"] });
    if (assoc.disburser) inc.push({ model: User, as: "disburser", attributes: ["id", "name", "email"] });
  }

  return inc;
}

const safeNum = (v) => Number(v || 0);

/* ===========================
   CREATE LOAN
=========================== */
const createLoan = async (req, res) => {
  try {
    if (!Loan) return res.status(501).json({ error: "Loan model not available" });

    const body = { ...req.body };

    if (body.productId && LoanProduct) {
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
    if (!Loan) return res.json([]);

    const where = {};
    if (req.query.status && req.query.status !== "all") where.status = req.query.status;
    if (req.query.branchId) where.branchId = req.query.branchId;
    if (req.query.borrowerId) where.borrowerId = req.query.borrowerId;

    const loans = await Loan.findAll({
      where,
      include: buildLoanIncludes(),
      order: buildCreatedOrder(Loan, "DESC"),
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
    if (!Loan) return res.status(404).json({ error: "Loan not found" });

    const { id } = req.params;
    const { includeRepayments = "true", includeSchedule = "true" } = req.query;

    const loan = await Loan.findByPk(id, {
      include: buildLoanIncludes(),
    });

    if (!loan) return res.status(404).json({ error: "Loan not found" });

    // ---- repayments (tolerant of differing schemas) ----
    let repayments = [];
    const totals = {
      principal: 0,
      interest: 0,
      fees: 0,
      penalties: 0,
      totalPaid: 0,
      outstanding: safeNum(loan.amount),
    };

    if (includeRepayments === "true" && LoanRepayment) {
      repayments = await LoanRepayment.findAll({
        where: { loanId: loan.id },
        order: [["dueDate", "DESC"], ["createdAt", "DESC"]], // ✅ dueDate (not 'date')
      });

      for (const r of repayments) {
        // Some schemas store breakdown in r.allocation array; if absent, skip safely
        const alloc = Array.isArray(r.allocation) ? r.allocation : [];
        for (const a of alloc) {
          totals.principal += safeNum(a.principal);
          totals.interest  += safeNum(a.interest);
          totals.fees      += safeNum(a.fees);
          totals.penalties += safeNum(a.penalties);
        }

        // Total paid on this repayment row — use the most likely fields
        const paid = r.amountPaid ?? r.amount ?? r.totalPaid ?? 0;
        totals.totalPaid += safeNum(paid);
      }

      // Basic outstanding calculation (principal + known interest - paid)
      totals.outstanding = Math.max(
        0,
        safeNum(loan.amount) + safeNum(loan.totalInterest) - totals.totalPaid
      );
    }

    // ---- schedule (if present) ----
    let schedule = [];
    if (includeSchedule === "true" && LoanSchedule) {
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
    if (!Loan) return res.status(501).json({ error: "Loan model not available" });

    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const before = loan.toJSON();
    const body = { ...req.body };
    const productId = body.productId ?? loan.productId;

    if (productId && LoanProduct) {
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
    if (!Loan) return res.status(501).json({ error: "Loan model not available" });

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
    if (!Loan) return res.status(404).json({ error: "Loan not found" });

    const loan = await Loan.findByPk(req.params.loanId || req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const input = {
      amount:       safeNum(loan.amount),
      interestRate: safeNum(loan.interestRate),
      term:         loan.termMonths,
      issueDate:    loan.startDate,
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
    if (!Loan) {
      await t.rollback();
      return res.status(501).json({ error: "Loan model not available" });
    }

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
      fields.approvedBy   = req.user?.id || null;
      fields.approvalDate = new Date();
    }

    if (status === "disbursed") {
      fields.disbursedBy     = req.user?.id || null;
      fields.disbursementDate = new Date();

      if (LoanSchedule) {
        const count = await LoanSchedule.count({ where: { loanId: loan.id }, transaction: t });
        if (count === 0) {
          const input = {
            amount:       safeNum(loan.amount),
            interestRate: safeNum(loan.interestRate),
            term:         loan.termMonths,
            issueDate:    loan.startDate,
          };
          const gen =
            loan.interestMethod === "flat"
              ? generateFlatRateSchedule(input)
              : loan.interestMethod === "reducing"
              ? generateReducingBalanceSchedule(input)
              : [];

          const rows = gen.map((s, i) => ({
            loanId:    loan.id,
            period:    i + 1,
            dueDate:   s.dueDate,
            principal: safeNum(s.principal),
            interest:  safeNum(s.interest),
            fees:      safeNum(s.fees),
            penalties: 0,
            total:     safeNum(s.total ?? (safeNum(s.principal) + safeNum(s.interest) + safeNum(s.fees))),
          }));

          if (rows.length) {
            await LoanSchedule.bulkCreate(rows, { transaction: t });
          }
        }
      }
    }

    if (status === "closed") {
      const outstanding = Number(loan.outstanding ?? 0);
      if (!override && outstanding > 0) {
        await t.rollback();
        return res.status(400).json({ error: "Outstanding > 0, override required" });
      }
      fields.closedBy   = req.user?.id || null;
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

    // Reload with safe includes
    const updatedLoan = await Loan.findByPk(req.params.id, {
      include: buildLoanIncludes(),
    });

    res.json({
      message: `Loan ${status} successfully`,
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
