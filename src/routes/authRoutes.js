const router = require("express").Router();
const authController = require("../controllers/authController");

router.post("/login", authController.login);
router.get("/test", (req, res) => res.send("Auth route working"));

module.exports = router;
