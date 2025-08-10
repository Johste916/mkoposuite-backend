const { Loan, Borrower, Branch, User, LoanProduct } = require("../models");
const {
  generateFlatRateSchedule,
  generateReducingBalanceSchedule,
} = require("../utils/generateSchedule");

const BORROWER_ATTRS = ["id", "name", "nationalId", "phone"];

// =========================
// CREATE LOAN
// =========================
const createLoan = async (req, res) => {
  try {
    // ✅ Validate against product limits if productId is provided
    if (req.body.productId) {
      const product = await LoanProduct.findByPk(req.body.productId);
      if (!product) {
        return res.status(400).json({ error: "Invalid loan product selected" });
      }

      // Check min/max principal
      if (product.minPrincipal && Number(req.body.amount) < Number(product.minPrincipal)) {
        return res.status(400).json({
          error: `Amount must be at least ${product.minPrincipal}`,
        });
      }
      if (product.maxPrincipal && Number(req.body.amount) > Number(product.maxPrincipal)) {
        return res.status(400).json({
          error: `Amount must not exceed ${product.maxPrincipal}`,
        });
      }

      // Check min/max term months
      if (product.minTermMonths && Number(req.body.termMonths) < Number(product.minTermMonths)) {
        return res.status(400).json({
          error: `Term must be at least ${product.minTermMonths} months`,
        });
      }
      if (product.maxTermMonths && Number(req.body.termMonths) > Number(product.maxTermMonths)) {
        return res.status(400).json({
          error: `Term must not exceed ${product.maxTermMonths} months`,
        });
      }

      // Auto-fill interest details if missing
      if (!req.body.interestMethod) {
        req.body.interestMethod = product.interestMethod || "flat";
      }
      if (!req.body.interestRate) {
        req.body.interestRate = product.interestRate || 0;
      }
    }

    const loan = await Loan.create({
      ...req.body,
      initiatedBy: req.user?.id || null,
      status: "pending",
    });
    res.status(201).json(loan);
  } catch (err) {
    console.error("Create loan error:", err);
    res.status(500).json({ error: "Failed to create loan" });
  }
};

// =========================
// GET ALL LOANS
// =========================
const getAllLoans = async (_req, res) => {
  try {
    const loans = await Loan.findAll({
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
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

// =========================
// GET LOAN BY ID
// =========================
const getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, {
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
        { model: User, as: "initiator", attributes: ["id", "name"] },
        { model: User, as: "approver", attributes: ["id", "name"] },
        { model: User, as: "rejector", attributes: ["id", "name"] },
        { model: User, as: "disburser", attributes: ["id", "name"] },
      ],
    });
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    res.json(loan);
  } catch (err) {
    console.error("Get loan by id error:", err);
    res.status(500).json({ error: "Error fetching loan" });
  }
};

// =========================
// UPDATE LOAN
// =========================
const updateLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    // ✅ Validate against product limits if productId is provided or already on loan
    const productIdToCheck = req.body.productId || loan.productId;
    if (productIdToCheck) {
      const product = await LoanProduct.findByPk(productIdToCheck);
      if (!product) {
        return res.status(400).json({ error: "Invalid loan product selected" });
      }

      const amountToCheck = req.body.amount ?? loan.amount;
      const termToCheck = req.body.termMonths ?? loan.termMonths;

      // Check min/max principal
      if (product.minPrincipal && Number(amountToCheck) < Number(product.minPrincipal)) {
        return res.status(400).json({
          error: `Amount must be at least ${product.minPrincipal}`,
        });
      }
      if (product.maxPrincipal && Number(amountToCheck) > Number(product.maxPrincipal)) {
        return res.status(400).json({
          error: `Amount must not exceed ${product.maxPrincipal}`,
        });
      }

      // Check min/max term months
      if (product.minTermMonths && Number(termToCheck) < Number(product.minTermMonths)) {
        return res.status(400).json({
          error: `Term must be at least ${product.minTermMonths} months`,
        });
      }
      if (product.maxTermMonths && Number(termToCheck) > Number(product.maxTermMonths)) {
        return res.status(400).json({
          error: `Term must not exceed ${product.maxTermMonths} months`,
        });
      }

      // Auto-fill interest details if missing in request
      if (req.body.interestMethod === undefined) {
        req.body.interestMethod = loan.interestMethod || product.interestMethod || "flat";
      }
      if (req.body.interestRate === undefined) {
        req.body.interestRate = loan.interestRate || product.interestRate || 0;
      }
    }

    await loan.update(req.body);
    res.json(loan);
  } catch (err) {
    console.error("Update loan error:", err);
    res.status(500).json({ error: "Error updating loan" });
  }
};

// =========================
// DELETE LOAN
// =========================
const deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    await loan.destroy();
    res.json({ message: "Loan deleted" });
  } catch (err) {
    console.error("Delete loan error:", err);
    res.status(500).json({ error: "Error deleting loan" });
  }
};

// =========================
// APPROVE LOAN
// =========================
const approveLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== "pending")
      return res.status(400).json({ error: "Invalid loan or status" });

    await loan.update({
      status: "approved",
      approvedBy: req.user?.id || null,
      approvalDate: new Date(),
      approvalComments: req.body.approvalComments || "",
    });

    res.json({ message: "Loan approved" });
  } catch (err) {
    console.error("Approve loan error:", err);
    res.status(500).json({ error: "Failed to approve loan" });
  }
};

// =========================
// REJECT LOAN
// =========================
const rejectLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== "pending")
      return res.status(400).json({ error: "Invalid loan or status" });

    await loan.update({
      status: "rejected",
      rejectedBy: req.user?.id || null,
      rejectionDate: new Date(),
      rejectionComments: req.body.rejectionComments || "",
    });

    res.json({ message: "Loan rejected" });
  } catch (err) {
    console.error("Reject loan error:", err);
    res.status(500).json({ error: "Failed to reject loan" });
  }
};

// =========================
// DISBURSE LOAN
// =========================
const disburseLoan = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    if (!loan || loan.status !== "approved")
      return res.status(400).json({ error: "Loan not approved" });

    await loan.update({
      status: "disbursed",
      disbursedBy: req.user?.id || null,
      disbursementDate: new Date(),
      disbursementMethod: req.body.disbursementMethod || "cash",
    });

    res.json({ message: "Loan disbursed" });
  } catch (err) {
    console.error("Disburse loan error:", err);
    res.status(500).json({ error: "Failed to disburse loan" });
  }
};

// =========================
// GET LOAN SCHEDULE
// =========================
const getLoanSchedule = async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    const msPerMonth = 1000 * 60 * 60 * 24 * 30;
    const duration = loan.termMonths
      ? loan.termMonths
      : Math.max(
          1,
          Math.ceil(
            (new Date(loan.endDate) - new Date(loan.startDate)) / msPerMonth
          )
        );

    const input = {
      amount: Number(loan.amount || 0),
      interestRate: Number(loan.interestRate || 0),
      term: duration,
      issueDate: loan.startDate,
    };

    const schedule =
      loan.interestMethod === "flat"
        ? generateFlatRateSchedule(input)
        : loan.interestMethod === "reducing"
        ? generateReducingBalanceSchedule(input)
        : [];

    if (!schedule.length)
      return res.status(400).json({ error: "Invalid interest method" });

    res.json({ loanId: loan.id, interestMethod: loan.interestMethod, schedule });
  } catch (err) {
    console.error("Get schedule error:", err);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
};

// =========================
// GET DISBURSEMENT LIST
// =========================
const getDisbursementList = async (_req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { status: "disbursed" },
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
        { model: User, as: "initiator", attributes: ["id", "name"] },
      ],
      order: [["disbursementDate", "DESC"]],
      limit: 500,
    });
    res.json(loans || []);
  } catch (err) {
    console.error("Disbursement list error:", err);
    res.status(500).json({ error: "Failed to fetch disbursements" });
  }
};

// =========================
// GET LOANS BY BORROWER
// =========================
const getLoansByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const loans = await Loan.findAll({
      where: { borrowerId },
      include: [
        { model: Borrower, attributes: BORROWER_ATTRS },
        { model: Branch, as: "branch" },
        { model: User, as: "initiator", attributes: ["id", "name"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(loans || []);
  } catch (err) {
    console.error("Get loans by borrower error:", err);
    res.status(500).json({ error: "Failed to fetch loans by borrower" });
  }
};

module.exports = {
  createLoan,
  getAllLoans,
  getLoanById,
  updateLoan,
  deleteLoan,
  approveLoan,
  rejectLoan,
  disburseLoan,
  getLoanSchedule,
  getDisbursementList,
  getLoansByBorrower,
};
