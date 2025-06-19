// backend/src/routes/borrowerRoutes.js

const express = require('express');
const router = express.Router();
const borrowerController = require('../controllers/borrowerController');

// Ensure these are all defined in your controller
router.get('/', borrowerController.getAllBorrowers);
router.post('/', borrowerController.createBorrower);
router.put('/:id', borrowerController.updateBorrower);
router.delete('/:id', borrowerController.deleteBorrower);

module.exports = router;
