const router = require("express").Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/summary", dashboardController.getDashboardSummary);

module.exports = router;
