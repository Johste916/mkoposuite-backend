// backend/src/routes/staffRoutes.js
const router = require('express').Router();
const staff = require('../controllers/admin/staffController');

let authenticateUser, allow;
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}
try { ({ allow } = require('../middleware/permissions')); } catch {}

const guard = (fn) => (typeof fn === 'function' ? fn : (_req, _res, next) => next());

router.use(guard(authenticateUser));

router.get('/',               guard(allow && allow('staff.read')),   staff.list);
router.post('/',              guard(allow && allow('staff.create')), staff.create);
router.get('/:id',            guard(allow && allow('staff.read')),   staff.getById);
router.put('/:id',            guard(allow && allow('staff.update')), staff.update);
router.patch('/:id/password', guard(allow && allow('staff.update')), staff.resetPassword);
router.patch('/:id/status',   guard(allow && allow('staff.update')), staff.toggleStatus);

module.exports = router;
