// src/routes/loanRoutes.js
const express = require("express");
const router = express.Router();
const loanController = require("../controllers/loanController");
const { authenticateUser } = require("../middleware/authMiddleware");

// =========================
// 📥 LIST & VIEW
// =========================
router.get("/", authenticateUser, loanController.getAllLoans);
router.get("/:id", authenticateUser, loanController.getLoanById);
router.get("/borrower/:borrowerId", authenticateUser, loanController.getLoansByBorrower);

// =========================
// 💰 CREATE, UPDATE, DELETE
// =========================
router.post("/", authenticateUser, loanController.createLoan);
router.put("/:id", authenticateUser, loanController.updateLoan);
router.delete("/:id", authenticateUser, loanController.deleteLoan);

// =========================
// ✅ STATUS CHANGES
// =========================
router.post("/:id/approve", authenticateUser, loanController.approveLoan);
router.post("/:id/reject", authenticateUser, loanController.rejectLoan);
router.post("/:id/disburse", authenticateUser, loanController.disburseLoan);

// =========================
// 📅 SCHEDULE & REPORTS
// =========================
router.get("/:loanId/schedule", authenticateUser, loanController.getLoanSchedule);
router.get("/reports/disbursements/list", authenticateUser, loanController.getDisbursementList);

module.exports = router;
