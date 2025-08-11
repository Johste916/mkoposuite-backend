// src/controllers/loanController.js
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
    // don’t block main flow on audit failure
    console.warn("audit write failed:", e.message);
  }
};

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

    const loans = await Loan.findAll({
      where,
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
        { model: LoanProduct, as: "product", attributes: ["id", "name", "code", "interestMethod", "interestRate"] },
        { model: User, as: "initiator", attributes: ["id", "name"] },
        { model: User, as: "approver", attributes: ["id", "name"] },
        { model: User, as: "rejector", attributes: ["id", "name"] },
        { model: User, as: "disburser", attributes: ["id", "name"] },
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

    const loan = await Loan.findByPk(id, {
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
        {
          model: LoanProduct,
          as: "product",
          attributes: [
            "id",
            "name",
            "code",
            "interestMethod",
            "interestRate",
            "minPrincipal",
            "maxPrincipal",
            "minTermMonths",
            "maxTermMonths",
          ],
        },
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
        order: [["date", "DESC"]],
      });

      for (const r of repayments) {
        const alloc = r.allocation || [];
        for (const a of alloc) {
          totals.principal += Number(a.principal || 0);
          totals.interest += Number(a.interest || 0);
          totals.fees += Number(a.fees || 0);
          totals.penalties += Number(a.penalties || 0);
        }
        totals.totalPaid += Number(r.amount || 0);
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
   STATUS UPDATE (strict) + SNAPSHOT ON DISBURSE + CLOSE RULES
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
      fields.approvedBy = req.user?.id || null;
      fields.approvalDate = new Date();
    }

    if (status === "disbursed") {
      fields.disbursedBy = req.user?.id || null;
      fields.disbursementDate = new Date();

      // Snapshot schedule once on disbursement if not present
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
          total:
            Number(s.total ?? Number(s.principal || 0) + Number(s.interest || 0) + Number(s.fees || 0)),
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
      fields.closedBy = req.user?.id || null;
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
    res.json(loan);
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
