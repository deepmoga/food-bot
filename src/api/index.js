const express = require('express');
const cors = require('cors');
const router = express.Router();
const { authMiddleware } = require('./middleware');

router.use(cors());

router.use('/auth', require('./auth'));

router.use(authMiddleware);

router.use('/dashboard', require('./dashboard'));
router.use('/orders', require('./orders'));
router.use('/menu', require('./menu'));
router.use('/store', require('./store'));

module.exports = router;
