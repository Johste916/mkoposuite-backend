'use strict';
const express = require('express');
const router = express.Router();

// Optional multer to accept multipart/form-data without files
let multer;
try { multer = require('multer'); } catch {}
const acceptFormData = multer ? multer().none() : (_req, _res, next) => next();

const {
  selfCheck,
  signup,
} = require('../controllers/publicSignupController');

// health/debug
router.get('/_selfcheck', selfCheck);

// main signup (accept JSON or multipart/form-data)
router.post('/', acceptFormData, signup);

module.exports = router;
