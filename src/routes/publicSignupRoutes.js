'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/publicSignupController');

router.get('/_selfcheck', ctrl.selfcheck);
router.post('/', ctrl.signup);

module.exports = router;
