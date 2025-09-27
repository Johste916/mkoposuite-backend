'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');

const upload = multer(); // to accept optional multipart form-data

const { authenticateUser } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/loanProductController');

/** Safe wrapper */
const h = (name) => (req, res, next) => {
  if (ctrl && typeof ctrl[name] === 'function') return ctrl[name](req, res, next);
  return res.status(501).json({ error: `Controller method ${name} is not implemented` });
};

// List & read
router.get('/', authenticateUser, h('list'));
router.get('/:id', authenticateUser, h('get'));

// Create/Update/Delete (accept JSON or multipart just in case the UI sends form-data)
router.post('/', authenticateUser, upload.any(), h('create'));
router.put('/:id', authenticateUser, upload.any(), h('update'));
router.delete('/:id', authenticateUser, h('remove'));

// Quick status toggle
router.patch('/:id/toggle', authenticateUser, upload.none(), h('toggleStatus'));

module.exports = router;
module.exports.default = router;
module.exports.router = router;
