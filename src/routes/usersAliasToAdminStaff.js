// backend/src/routes/usersAliasToAdminStaff.js
const router = require('express').Router();
const staff = require('../controllers/admin/staffController');
router.get('/', staff.list);
router.post('/', staff.create);
router.get('/:id', staff.getById);
router.put('/:id', staff.update);
router.patch('/:id/password', staff.resetPassword);
router.patch('/:id/status', staff.toggleStatus);
module.exports = router;
