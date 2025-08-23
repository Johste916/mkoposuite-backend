'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collateralController');
// If you want auth on these, uncomment the next line and add to each route.
// const { authenticateUser } = require('../middleware/authMiddleware');

// Base: /api/collateral
router.get('/', /*authenticateUser,*/ ctrl.list);
router.get('/:id', /*authenticateUser,*/ ctrl.get);
router.post('/', /*authenticateUser,*/ ctrl.create);
router.put('/:id', /*authenticateUser,*/ ctrl.update);
router.delete('/:id', /*authenticateUser,*/ ctrl.remove);

module.exports = router;
