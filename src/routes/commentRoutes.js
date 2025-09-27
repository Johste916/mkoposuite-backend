'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();

const { authenticateUser } = require('../middleware/authMiddleware');
const comments = require('../controllers/commentController');

// list comments for a loan
router.get('/loan/:loanId', authenticateUser, comments.listLoanComments);

// add a comment to a loan (accepts JSON or form-data)
router.post('/loan/:loanId', authenticateUser, upload.any(), comments.addLoanComment);

module.exports = router;
module.exports.default = router;
module.exports.router = router;
