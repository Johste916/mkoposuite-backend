const router = require('express').Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const userCtrl = require('../controllers/userController');

router.use(authenticateUser);

/* Lightweight list for filters (Borrowers page) */
router.get('/', userCtrl.getUsers);

/* User profile APIs */
router.get('/:id', userCtrl.getUserById);
router.post('/', userCtrl.createUser);
router.put('/:id', userCtrl.updateUser);
router.patch('/:id/password', userCtrl.resetPassword);
router.patch('/:id/status', userCtrl.toggleStatus);

module.exports = router;
