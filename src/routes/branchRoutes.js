'use strict';
const express = require('express');
const { allow } = require('../middleware/permissions');
const ctrl = require('../controllers/branchController');

const r = express.Router();

// IMPORTANT: your server has an early GET '/api/branches' fallback.
// Use '/list' here to avoid that conflict.
r.get('/list', allow('branches:view'), ctrl.list);
r.post('/',    allow('branches:manage'), ctrl.create);
r.get('/:id',  allow('branches:view'),   ctrl.getOne);
r.put('/:id',  allow('branches:manage'), ctrl.update);
r.delete('/:id', allow('branches:manage'), ctrl.remove);

// Assignments
r.get('/:id/staff',               allow('branches:view'),    ctrl.listStaff);
r.post('/:id/staff',              allow('branches:assign'),  ctrl.assignStaff);
r.delete('/:id/staff/:userId',    allow('branches:assign'),  ctrl.unassignStaff);

r.get('/:id/borrowers',           allow('branches:view'),    ctrl.listBorrowers);
r.post('/:id/borrowers',          allow('branches:assign'),  ctrl.assignBorrowers);
r.delete('/:id/borrowers/:borrowerId', allow('branches:assign'), ctrl.unassignBorrower);

// Stats
r.get('/:id/stats', allow('branches:view'), ctrl.stats);

module.exports = r;
