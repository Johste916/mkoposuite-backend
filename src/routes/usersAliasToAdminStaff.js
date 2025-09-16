// backend/src/routes/usersAliasToAdminStaff.js
const router = require('express').Router();
let staff;
try {
  staff = require('../controllers/admin/staffController');
} catch {
  staff = null;
}

// Optional auth if your stack expects it
let authenticateUser = (_req, _res, next) => next();
try {
  authenticateUser = require('../middleware/authMiddleware').authenticateUser || authenticateUser;
} catch {}

router.use(authenticateUser);

if (!staff) {
  // Graceful 501s if controller isn't present
  router.all('*', (_req, res) => res.status(501).json({ error: 'admin/staffController not available' }));
} else {
  router.get('/', staff.list);
  router.post('/', staff.create);
  router.get('/:id', staff.getById);
  router.put('/:id', staff.update);
  router.patch('/:id/password', staff.resetPassword);
  router.patch('/:id/status', staff.toggleStatus);
}

module.exports = router;
