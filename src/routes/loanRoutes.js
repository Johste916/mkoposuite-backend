// backend/routes/loanRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/loanController");

// Loan CRUD
router.get("/", authenticateUser, ctrl.getAllLoans);
router.post("/", authenticateUser, ctrl.createLoan);
router.get("/:id", authenticateUser, ctrl.getLoanById);
router.put("/:id", authenticateUser, ctrl.updateLoan);
router.delete("/:id", authenticateUser, ctrl.deleteLoan);

// Status-specific actions (to match frontend)
router.patch("/:id/approve", authenticateUser, (req, res) => {
  req.body.status = "approved";
  ctrl.updateLoanStatus(req, res);
});
router.patch("/:id/reject", authenticateUser, (req, res) => {
  req.body.status = "rejected";
  ctrl.updateLoanStatus(req, res);
});
router.patch("/:id/disburse", authenticateUser, (req, res) => {
  req.body.status = "disbursed";
  ctrl.updateLoanStatus(req, res);
});
router.patch("/:id/close", authenticateUser, (req, res) => {
  req.body.status = "closed";
  ctrl.updateLoanStatus(req, res);
});

// Generic status update
router.patch("/:id/status", authenticateUser, ctrl.updateLoanStatus);

// Loan schedule
router.get("/:loanId/schedule", authenticateUser, ctrl.getLoanSchedule);

module.exports = router;
