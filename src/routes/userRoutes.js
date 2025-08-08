const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authMiddleware');
const userController = require('../controllers/userController');

router.get('/', authenticateUser, userController.getUsers);
router.post('/', authenticateUser, userController.createUser);

module.exports = router;
