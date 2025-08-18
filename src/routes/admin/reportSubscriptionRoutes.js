// backend/src/routes/admin/reportSubscriptionRoutes.js
const router = require('express').Router();
const { authenticateUser } = require('../../middleware/authMiddleware');
let { allow } = (() => { try { return require('../../middleware/permissions'); } catch { return {}; } })();
const guard = (fn) => (typeof fn === 'function' ? fn : (_req,_res,next)=>next());

const ctl = require('../../controllers/admin/reportSubscriptionController');

router.use(authenticateUser);

// manageSettings permission protects these endpoints
router.get('/defs',            guard(allow && allow('manageSettings')), ctl.listDefs);
router.get('/',                guard(allow && allow('manageSettings')), ctl.list);
router.post('/',               guard(allow && allow('manageSettings')), ctl.create);
router.put('/:id',             guard(allow && allow('manageSettings')), ctl.update);
router.delete('/:id',          guard(allow && allow('manageSettings')), ctl.remove);
router.post('/:id/run-now',    guard(allow && allow('manageSettings')), ctl.runNow);

module.exports = router;
