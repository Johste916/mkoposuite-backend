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

// Status update (generic)
router.patch("/:id/status", authenticateUser, ctrl.updateLoanStatus);

// Loan schedule
router.get("/:loanId/schedule", authenticateUser, ctrl.getLoanSchedule);

module.exports = router;
