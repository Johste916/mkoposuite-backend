'use strict';
const express = require('express');
const router = express.Router();
const hr = require('../controllers/hrController');
const pr = require('../controllers/payrollController');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

/* ------------------------------- contracts upload ------------------------------- */
const contractsDir = path.resolve(__dirname, '../uploads/contracts');
fs.mkdirSync(contractsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, contractsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g,'_')}`)
});
const upload = multer({ storage });

/* --------------------------------- Employees --------------------------------- */
router.get('/employees', hr.listEmployees);
router.get('/employees/:id', hr.getEmployee);
router.post('/employees', hr.createEmployee);
router.put('/employees/:id', hr.updateEmployee);
router.delete('/employees/:id', hr.deleteEmployee);

/* -------------------------------- Attendance -------------------------------- */
router.get('/attendance', hr.listAttendance);

/* ----------------------------------- Leave ---------------------------------- */
router.get('/leave/types', hr.listLeaveTypes);
router.get('/leave/my-requests', hr.myLeaveRequests);
router.post('/leave/requests', hr.createLeave);

/* --------------------------------- Contracts -------------------------------- */
router.get('/contracts', hr.listContracts);
router.post('/contracts', upload.single('file'), hr.createContract);

/* ------------------------------- Payroll (nested) --------------------------- */
const pay = express.Router();
pay.get('/runs', pr.listRuns);
pay.get('/runs/:id', pr.getRun);
pay.post('/runs', pr.createRun);
pay.get('/stats', pr.stats);
pay.get('/report', pr.report);

router.use('/payroll', pay);

module.exports = router;
