'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/collateralController');

/**
 * NOTE: Place specific routes BEFORE "/:id" so they aren't captured by the param route.
 */

// Borrower helper: list open loans for borrower (used by the form)
router.get('/borrowers/:borrowerId/open-loans', authenticateUser, ctrl.borrowerOpenLoans);

// List / Create
router.get('/', authenticateUser, ctrl.list);
router.post('/', authenticateUser, ctrl.create);

// Get one / Update / Delete / Release
router.get('/:id', authenticateUser, ctrl.get);
router.put('/:id', authenticateUser, ctrl.update);
router.post('/:id/release', authenticateUser, ctrl.release);
router.delete('/:id', authenticateUser, ctrl.remove);

module.exports = router;
