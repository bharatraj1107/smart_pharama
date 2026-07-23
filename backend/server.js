require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const User = require("./models/User");
const UserRequest = require("./models/UserRequest");
const Foil = require("./models/Foil");
const Message = require("./models/Message");

const QrScanLog = require('./models/QrScanLog');
const { buildFoilQrPayload, parseFoilQrPayload } = require('./qr/qrPayload');

const Cylinder = require("./models/Cylinder");
const AuditLog = require("./models/AuditLog");
const Task = require("./models/Task");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const path = require("path");
const multer = require("multer");
const app = express();
app.use(express.json({ limit: '10mb' }));
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://192.168.56.1:3000",
  "https://backend-u4si.onrender.com",
  // Mobile app on local Wi-Fi (Expo Go on phone → laptop Wi-Fi IP)
  "http://10.20.43.184:3000",
  "http://10.20.43.184:8081",
  "http://10.20.43.184:19000",
  "http://10.20.43.184:19006",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// QR routes
const qrRoutes = require('./routes/qrRoutes');
app.use('/qrs', qrRoutes);

app.get("/", (req, res) => {

  res.send("🚀 Smart Pharma Backend Running Successfully");
});

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017/pharma";
const MONGODB_URI = (process.env.MONGODB_URI || DEFAULT_MONGODB_URI).trim();

async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("DB Connected to", MONGODB_URI.startsWith("mongodb://127.0.0.1") ? "local MongoDB" : "MongoDB Atlas");
  } catch (err) {
    console.error("DB connection failed for URI:", MONGODB_URI);
    console.error(err.message || err);

    if (MONGODB_URI !== DEFAULT_MONGODB_URI) {
      console.log("Attempting fallback to local MongoDB...");
      try {
        await mongoose.connect(DEFAULT_MONGODB_URI);
        console.log("DB Connected to local MongoDB fallback");
        return;
      } catch (fallbackErr) {
        console.error("Local MongoDB fallback failed:", fallbackErr.message || fallbackErr);
      }
    }

    console.error("Please start a local MongoDB instance or update MONGODB_URI in .env with a reachable database server.");
    process.exit(1);
  }
}

const SECRET = process.env.JWT_SECRET || "MY_SECRET_KEY";

const COMPANY_NAMES = {
  bharath: "Bharath Enterprises",
  shree_ganaapathy: "Shree Ganaapathy Roto Prints",
  vel: "Vel Gravure"
};

const IGNORED_COMPANY_WORDS = new Set(["company", "co", "pvt", "ltd", "private", "limited", "print", "prints", "solutions", "services", "industries", "labs", "laboratories", "products"]);

function getCompanyPrefix(companyKey) {
  const companyName = COMPANY_NAMES[companyKey] || String(companyKey || "");
  const words = companyName
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !IGNORED_COMPANY_WORDS.has(word.toLowerCase()));

  const significantWords = words.slice(0, 2);
  return significantWords.map((word) => word[0].toUpperCase()).join("");
}

async function getNextEmployeeNo(companyKey) {
  const prefix = getCompanyPrefix(companyKey);
  if (!prefix) return "";

  const regex = new RegExp(`^${prefix}(\\d{3})$`, "i");
  const users = await User.find({ company: companyKey, employeeNo: { $regex: regex } }).select("employeeNo");

  let maxSeq = 0;
  users.forEach((user) => {
    const match = String(user.employeeNo).match(regex);
    if (match) {
      const seq = Number(match[1]);
      if (!Number.isNaN(seq)) {
        maxSeq = Math.max(maxSeq, seq);
      }
    }
  });

  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

const getMaterialKind = (company) => company === "shree_ganaapathy" ? "plastic" : "foil";
const getCylinderKind = (company) => company === "shree_ganaapathy" ? "plastic_cylinder" : "standard";

async function getRequestCompany(req) {
  if (req.user.company) return req.user.company;
  const user = await User.findById(req.user.id).select("company");
  return user?.company || "bharath";
}

function companyQuery(company) {
  return { $or: [{ company }, { company: { $exists: false } }, { company: null }] };
}

// 🔧 QR GENERATOR
async function generateFoilQrPayload({ company, type, size, kg, version = 1 }) {
  // Auto-increment serial starting from 1
  const lastFoil = await Foil.findOne({ company }).sort({ serial: -1 }).select("serial");
  const lastSerial = lastFoil ? parseInt(lastFoil.serial, 10) : 0;
  const serial = String((isNaN(lastSerial) ? 0 : lastSerial) + 1);
  return { qrPayload: buildFoilQrPayload({ company, type, size, weightKg: kg, version, serial }), serial };
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
}

function getFoilBalance(foil) {
  const balance = foil?.remainingWeight ?? foil?.weight ?? 0;
  return Number(balance) || 0;
}

function setFoilBalance(foil, balance) {
  const next = Math.max(0, Number(balance) || 0);
  foil.weight = next;
  foil.remainingWeight = next;
}

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeFoilScansInput(reqBody, task) {
  const rawScans = parseJsonField(reqBody.foilScans, null)
    || parseJsonField(reqBody.foilUsage, null)
    || parseJsonField(reqBody.foilQrPayloads, null);

  if (Array.isArray(rawScans)) {
    return rawScans.map((entry, index) => {
      if (typeof entry === "string") return { colourNumber: index + 1, qrPayload: entry };
      return {
        colourNumber: Number(entry.colourNumber || entry.colour || index + 1),
        qrPayload: entry.qrPayload || entry.foil_qrPayload || entry.foilQrPayload || entry.value || ""
      };
    });
  }

  if (typeof rawScans === "string" && rawScans.trim()) {
    return [{ colourNumber: 1, qrPayload: rawScans.trim() }];
  }

  const singlePayload = reqBody.foil_qrPayload
    || reqBody.foilQrPayload
    || reqBody.qrPayload
    || reqBody.barcode
    || task.assigned_foil_qrPayload
    || task.foil_qrPayload;

  return singlePayload ? [{ colourNumber: 1, qrPayload: singlePayload }] : [];
}

async function getActorName(req) {
  const user = await User.findById(req.user.id).select("name email");
  return user?.name || user?.email || req.user.id;
}

async function validateFoilForTask({ qrPayload, task, company, colourNumber, allowDuplicate = false }) {
  const payload = String(qrPayload || "").trim();
  if (!payload) {
    return { ok: false, status: "invalid", message: `Scan foil for Colour ${colourNumber}` };
  }

  try {
    parseFoilQrPayload(payload);
  } catch (err) {
    return { ok: false, status: "invalid", message: err.message || "Invalid foil QR payload" };
  }

  const foil = await Foil.findOne({ qrPayload: payload, company });
  if (!foil) {
    return { ok: false, status: "not-found", message: "Foil QR payload not found in this company" };
  }

  const balance = getFoilBalance(foil);
  if (balance <= 0) {
    return { ok: false, status: "consumed", message: "Foil balance is unavailable" };
  }

  if (task.foil_type && normalizeComparable(foil.type) !== normalizeComparable(task.foil_type)) {
    return { ok: false, status: "mismatch", message: `Foil type must be ${task.foil_type}` };
  }

  if (task.size && normalizeComparable(foil.size) !== normalizeComparable(task.size)) {
    return { ok: false, status: "mismatch", message: `Foil size must be ${task.size}` };
  }

  if (!allowDuplicate && Array.isArray(task.foilUsage)) {
    const alreadyLinked = task.foilUsage.some((entry) => String(entry.foilId || "") === String(foil._id));
    if (alreadyLinked) {
      return { ok: false, status: "duplicate", message: "This foil roll is already linked to the task" };
    }
  }

  return { ok: true, foil, balance };
}

function generateCylinderBarcode(size, color) {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `CYL-${size}-${color}CLR-${random}`;
}


// 🔐 LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(401).send("User not found");

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).send("Wrong password");

  const token = jwt.sign({ id: user._id, role: user.role, company: user.company }, SECRET, { expiresIn: "1d" });

  res.json({ token, role: user.role, name: user.name, company: user.company, companyName: COMPANY_NAMES[user.company] });
});

// PASSWORD VALIDATION
function isStrongPassword(password) {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
  return regex.test(password);
}

// MOCK TRANSPORTER (console.log OTP - provide SMTP for real email)
const transporter = {
  sendMail: async ({ to, subject, text }) => {
    const otp = text.match(/(\d{6})/)[1];
    console.log(`📧 MOCK EMAIL to ${to}: ${text}`);
    console.log(`Use OTP: ${otp}`);
    return true;
  }
};

// 🔐 TOKEN VERIFY
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) return res.status(403).send("No token");

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).send("Invalid token");
  }
};

// 🔐 ROLE CHECK
const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).send("Access denied");
    }
    next();
  };
};

function getConversationId(userAId, userBId) {
  const a = String(userAId || "");
  const b = String(userBId || "");
  return [a, b].sort().join("-");
}

app.post("/api/messages", verifyToken, async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });

    const senderId = req.user.id;
    const conversationId = getConversationId(senderId, receiverId);
    const company = await getRequestCompany(req);

    const msg = await Message.create({
      company,
      senderId,
      receiverId,
      conversationId,
      text: String(text).trim(),
      timestamp: new Date()
    });

    return res.json({ message: "Message sent", msg });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// GET /api/messages/:conversationId
app.get("/api/messages/:conversationId", verifyToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!conversationId) return res.status(400).json({ error: "conversationId is required" });

    const company = await getRequestCompany(req);

    const msgs = await Message.find({
      company,
      conversationId
    })
      .sort({ timestamp: 1 })
      .select("senderId receiverId conversationId text timestamp createdAt");

    return res.json({ messages: msgs });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// GET /profile — own profile

app.get("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /profile — update own profile
app.put("/profile", verifyToken, async (req, res) => {
  try {
    const { phone, dob, age, address, emergencyContact, joiningDate } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (phone !== undefined) user.phone = phone;
    if (dob !== undefined) user.dob = dob;
    if (age !== undefined) user.age = age;
    if (address !== undefined) user.address = address;
    if (emergencyContact !== undefined) user.emergencyContact = emergencyContact;
    if (joiningDate !== undefined) user.joiningDate = joiningDate;

    await user.save();
    const updated = user.toObject();
    delete updated.password;
    res.json({ message: "Profile updated", user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /staff — CEO and Admin can view all company staff profiles
app.get("/staff", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const staff = await User.find({ company }).select("-password").sort({ role: 1, name: 1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /staff/:id — CEO and Admin can view a specific profile
app.get("/staff/:id", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /staff/:id/salary — CEO and Admin set salary rate for staff
app.put("/staff/:id/salary", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  try {
    const { salaryRate, salaryType } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (salaryRate !== undefined) user.salaryRate = Number(salaryRate);
    if (salaryType) user.salaryType = salaryType;

    await user.save();
    const updated = user.toObject();
    delete updated.password;
    res.json({ message: "Salary updated", user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function createAuditLog({ req, action, itemType, before, after }) {
  const user = await User.findById(req.user.id).select("name email role");
  const actorName = user?.name || user?.email || req.user.id;
  const item = after || before;
  const company = item?.company || await getRequestCompany(req);

  try {
    await AuditLog.create({
      action,
      itemType,
      company,
      itemId: String(item?._id || ""),
      barcode: item?.barcode || "",
      qrPayload: item?.qrPayload || "",
      changedBy: actorName,
      changedByRole: req.user.role,
      before,
      after
    });
  } catch (err) {
    console.error("Audit log creation failed:", err);
  }
}

// 📩 SIGNUP WITH OTP (worker/manager only)
app.post("/signup", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    dob,
    age,
    joiningDate,
    idProofType,
    idProofNumber,
    password,
    role,
    company
  } = req.body;

  if (role === "admin" || role === "ceo") {
    return res.status(403).send("Role not allowed");
  }

  if (!COMPANY_NAMES[company]) {
    return res.status(400).send("Please select a valid company");
  }

  if (!isStrongPassword(password)) {
    return res.status(400).send("Weak password - use 8+ chars, Upper, lower, number, special");
  }

  const hashed = await bcrypt.hash(password, 10);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const user = new UserRequest({
    firstName,
    lastName,
    email,
    phone,
    dob: new Date(dob),
    age: Number(age),
    joiningDate: new Date(joiningDate),
    idProofType,
    idProofNumber,
    password: hashed,
    role,
    company,
    otp,
    otpVerified: false
  });

  await user.save();

  await transporter.sendMail({
    to: email,
    subject: "OTP Verification",
    text: `Your OTP is ${otp}`
  });

  res.send("OTP sent - check server terminal");
});

// 👨‍💼 VIEW REQUESTS (ADMIN/CEO) - only otpVerified pending
app.get("/requests", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  const company = await getRequestCompany(req);
  const data = await UserRequest.find({ company, status: "pending", otpVerified: true });
  res.json(data);
});

// 📩 VERIFY OTP
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  const user = await UserRequest.findOne({ email });

  if (!user || user.otp !== otp) {
    return res.status(400).send("Invalid OTP");
  }

  user.otpVerified = true;
  await user.save();

  res.send("OTP Verified, waiting for admin approval");
});

// ✅ APPROVE REQUEST
app.post("/approve", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  const { id } = req.body;
  const reqUser = await UserRequest.findById(id);

  if (!reqUser) return res.status(404).send("Not found");

  const user = new User({
    name: `${reqUser.firstName} ${reqUser.lastName}`,
    email: reqUser.email,
    password: reqUser.password,
    role: reqUser.role,
    company: reqUser.company,
    employeeNo: await getNextEmployeeNo(reqUser.company)
  });

  await user.save();
  reqUser.status = "approved";
  await reqUser.save();

  res.send("User approved");
});

// ❌ REJECT REQUEST
app.post("/reject", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  const { id } = req.body;
  await UserRequest.findByIdAndUpdate(id, { status: "rejected" });
  res.send("Rejected");
});

// GET all tasks
app.get("/tasks", verifyToken, async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const tasks = await Task.find({ company });
    res.json(tasks);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ✅ CREATE TASK
app.post("/tasks", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { foil_qrPayload, cylinder_barcode, worker_name, colourCount } = req.body;

    const company = await getRequestCompany(req);

    if (!worker_name || !worker_name.trim()) {
      return res.status(400).send("Worker name is required");
    }
    const parsedColourCount = Number(colourCount || 1);
    if (!Number.isInteger(parsedColourCount) || parsedColourCount < 1 || parsedColourCount > 8) {
      return res.status(400).send("Number of Colours must be between 1 and 8");
    }

    const task = new Task({
      foil_qrPayload,
      assigned_foil_qrPayload: foil_qrPayload,

      cylinder_barcode,
      worker_name: worker_name.trim(),
      colourCount: parsedColourCount,
      company
    });

    await task.save();
    res.json({ message: "Task assigned successfully", task });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ✅ ADD FOIL
app.post("/add-foil", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { type, size, weight } = req.body;

    const company = await getRequestCompany(req);
    const materialKind = getMaterialKind(company);

    if (company === "vel") {
      return res.status(403).send("Vel Gravure uses cylinder stock only");
    }

    const allowedTypes = materialKind === "plastic"
      ? ["wrapper", "pouch", "laminated", "roll"]
      : ["blister", "alualu"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).send(`Invalid type. Allowed values: ${allowedTypes.join(", ")}`);
    }

    if (!type || !size || !weight) {
      return res.status(400).send("Type, Size, and Weight are required");
    }

    const { qrPayload: generatedQrPayload, serial } = await generateFoilQrPayload({ company, type, size, kg: weight, version: 1 });

    const foil = new Foil({
      company,
      materialKind,
      type,
      size,
      weight,
      remainingWeight: Number(weight),
      qrPayload: generatedQrPayload,
      version: 1,
      serial
    });

    await foil.save();
    await createAuditLog({
      req,
      action: "create",
      itemType: "foil",
      before: null,
      after: foil.toObject()
    });
    res.json({ message: "✅ Foil added successfully", foil, qrPayload: generatedQrPayload });

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// 🔧 ADD CYLINDER
app.post("/add-cylinder", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { product_name, colors, size_inches, manufacturer, manufacture_date } = req.body;
    const company = await getRequestCompany(req);

    if (!product_name || !colors || !size_inches || !manufacturer || !manufacture_date) {
      return res.status(400).send("All fields are required");
    }

    const generatedBarcode = generateCylinderBarcode(`${size_inches}IN`, colors);

    const cylinder = new Cylinder({
      company,
      cylinderKind: getCylinderKind(company),
      product_name,
      colors,
      size_inches,
      manufacturer,
      manufacture_date: new Date(manufacture_date),
      barcode: generatedBarcode
    });

    await cylinder.save();
    await createAuditLog({
      req,
      action: "create",
      itemType: "cylinder",
      before: null,
      after: cylinder.toObject()
    });
    res.json({ message: "✅ Cylinder added successfully", cylinder, barcode: generatedBarcode });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ✅ GET ALL FOILS
app.get("/foils", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {

  try {
    const company = await getRequestCompany(req);
    const foils = company === "vel" ? [] : await Foil.find({ company });
    res.json(foils);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ✅ GET FOIL BY BARCODE
app.get("/foils/barcode/:barcode", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {

  try {
    const company = await getRequestCompany(req);
    const foil = await Foil.findOne({ barcode: req.params.barcode, company });
    if (!foil) return res.status(404).send("Foil not found or not in your company");
    res.json(foil);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ✅ UPDATE FOIL
app.put("/foils/:id", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { type, size, weight } = req.body;
    const company = await getRequestCompany(req);
    const materialKind = getMaterialKind(company);

    if (company === "vel") {
      return res.status(403).send("Vel Gravure uses cylinder stock only");
    }

    const allowedTypes = materialKind === "plastic"
      ? ["wrapper", "pouch", "laminated", "roll"]
      : ["blister", "alualu"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).send(`Invalid type. Allowed values: ${allowedTypes.join(", ")}`);
    }

    if (!type || !size || !weight) {
      return res.status(400).send("Type, Size, and Weight are required");
    }

    const foil = await Foil.findById(req.params.id);
    if (!foil) return res.status(404).send("Foil not found");
    if (foil.company && foil.company !== company) return res.status(403).send("Access denied");

    const before = foil.toObject();
    foil.company = foil.company || company;
    foil.materialKind = materialKind;
    foil.type = type;
    foil.size = size;
    setFoilBalance(foil, Number(weight));

    await foil.save();
    await createAuditLog({
      req,
      action: "edit",
      itemType: "foil",
      before,
      after: foil.toObject()
    });

    res.json({ message: "Foil updated successfully", foil });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ❌ DELETE FOIL
app.delete("/foils/:id", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const foil = await Foil.findById(req.params.id);
    if (!foil) return res.status(404).send("Foil not found");
    if (foil.company && foil.company !== company) return res.status(403).send("Access denied");
    
    await foil.deleteOne();

    await createAuditLog({
      req,
      action: "delete",
      itemType: "foil",
      before: foil.toObject(),
      after: null
    });

    res.json({ message: "Foil deleted successfully" });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ✅ GET ALL CYLINDERS
app.get("/cylinders", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const cylinders = await Cylinder.find({ company });
    res.json(cylinders);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ✅ UPDATE CYLINDER
app.put("/cylinders/:id", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { product_name, colors, size_inches, manufacturer, manufacture_date } = req.body;
    const company = await getRequestCompany(req);

    if (!product_name || !colors || !size_inches || !manufacturer || !manufacture_date) {
      return res.status(400).send("Product, colors, size, manufacturer, and manufacture date are required");
    }

    const cylinder = await Cylinder.findById(req.params.id);
    if (!cylinder) return res.status(404).send("Cylinder not found");
    if (cylinder.company && cylinder.company !== company) return res.status(403).send("Access denied");

    const before = cylinder.toObject();
    cylinder.company = cylinder.company || company;
    cylinder.cylinderKind = getCylinderKind(company);
    cylinder.product_name = product_name;
    cylinder.colors = Number(colors);
    cylinder.size_inches = Number(size_inches);
    cylinder.manufacturer = manufacturer;
    cylinder.manufacture_date = new Date(manufacture_date);

    await cylinder.save();
    await createAuditLog({
      req,
      action: "edit",
      itemType: "cylinder",
      before,
      after: cylinder.toObject()
    });

    res.json({ message: "Cylinder updated successfully", cylinder });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ❌ DELETE CYLINDER
app.delete("/cylinders/:id", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const cylinder = await Cylinder.findById(req.params.id);
    if (!cylinder) return res.status(404).send("Cylinder not found");
    if (cylinder.company && cylinder.company !== company) return res.status(403).send("Access denied");
    
    await cylinder.deleteOne();

    await createAuditLog({
      req,
      action: "delete",
      itemType: "cylinder",
      before: cylinder.toObject(),
      after: null
    });

    res.json({ message: "Cylinder deleted successfully" });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ✅ GET STOCK LOGS
app.get("/stock-logs", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const logs = await AuditLog.find({ company }).sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/audit-logs", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const logs = await AuditLog.find({ company }).sort({ createdAt: -1 }).limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/reports/foil-usage", verifyToken, allowRoles("admin", "manager", "ceo", "worker"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const tasks = await Task.find({ company }).sort({ updatedAt: -1 }).limit(200);
    const rows = tasks
      .filter((task) => Array.isArray(task.foilUsage) && task.foilUsage.length > 0)
      .map((task) => {
        const totalFoilUsed = task.foilUsage.reduce((sum, entry) => sum + Number(entry.usedWeight || 0), 0);
        const expectedUsage = Number(task.required_kg || 0) * Number(task.colourCount || 1);
        const variance = expectedUsage ? Number((totalFoilUsed - expectedUsage).toFixed(3)) : 0;
        return {
          taskId: task._id,
          productName: task.product_name,
          workerName: task.worker_name,
          status: task.status,
          colourCount: task.colourCount || 1,
          requiredKg: task.required_kg || 0,
          expectedUsage,
          totalFoilUsed: Number(totalFoilUsed.toFixed(3)),
          wasteKg: task.waste_kg || 0,
          variance,
          updatedAt: task.updatedAt,
          foilUsage: task.foilUsage
        };
      });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== NEW TASK CREATION WITH UPLOAD ==========
const taskStorage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `task-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`);
  }
});
const taskUpload = multer({ storage: taskStorage }).single('image');

app.post('/tasks-create', verifyToken, allowRoles("admin", "manager", "ceo"), taskUpload, async (req, res) => {
  try {
    const { product_name, size, required_kg, company: bodyCompany, worker_name, colourCount } = req.body;
    const company = bodyCompany || await getRequestCompany(req);
    const parsedColourCount = Number(colourCount);

    if (!product_name || !size || !required_kg) {
      return res.status(400).send("Product name, size, required KG required");
    }
    if (!worker_name) {
      return res.status(400).send("Worker name is required");
    }
    if (!Number.isInteger(parsedColourCount) || parsedColourCount < 1 || parsedColourCount > 8) {
      return res.status(400).send("Number of Colours must be between 1 and 8");
    }
    if (!COMPANY_NAMES[company]) {
      return res.status(400).send("Invalid company");
    }

    const image_path = req.file ? req.file.path.replace(/\\/g, '/') : null; // normalize path

    // Auto-assign an available foil matching foil_type/size and weight >= required_kg (if foil_type/size are present)
    // This is required so that worker barcode scans can be validated.
    let assignedFoilQrPayload = '';

    try {
      const { foil_type, size: formSize } = req.body;
      const foilSize = formSize || size;
      const candidate = await Foil.findOne({
        company,
        type: foil_type || undefined,
        size: foilSize,
        weight: { $gt: 0 },
      }).sort({ version: 1 });

      if (candidate?.qrPayload) assignedFoilQrPayload = candidate.qrPayload;

    } catch (e) {
      // ignore auto-assign failure; start validation will block until assigned
    }

    const task = new Task({
      company,
      product_name,
      size,
      required_kg: Number(required_kg),
      colourCount: parsedColourCount,
      foil_type: req.body.foil_type,
      worker_name: worker_name.trim(),
      image_path,

      // Use assigned barcode for validation (security)
      assigned_foil_qrPayload: assignedFoilQrPayload || undefined

    });

    await task.save();

    createAuditLog({
      req,
      action: "create",
      itemType: "task",
      before: null,
      after: task.toObject()
    }).catch((auditErr) => {
      console.error("Audit log failed for task creation:", auditErr);
    });

    res.json({ message: "✅ Task created successfully", task });
  } catch (err) {
    console.error('tasks-create error:', err);
    res.status(500).json({
      message: 'Error creating task',
      details: err?.message || String(err)
    });
  }
});

// ✅ UPDATE TASK (admin/ceo)
app.put('/tasks/:id', verifyToken, allowRoles('admin', 'ceo'), multer({ storage: taskStorage }).single('image'), async (req, res) => {
  try {
    const { product_name, size, required_kg, colourCount, company: bodyCompany } = req.body;
    const company = bodyCompany || await getRequestCompany(req);

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).send('Task not found');
    if (task.company && task.company !== company) return res.status(403).send('Access denied');

    const before = task.toObject();

    task.company = task.company || company;
    if (product_name !== undefined) task.product_name = product_name;
    if (size !== undefined) task.size = size;
    if (required_kg !== undefined) task.required_kg = Number(required_kg);
    if (colourCount !== undefined) {
      const parsedColourCount = Number(colourCount);
      if (!Number.isInteger(parsedColourCount) || parsedColourCount < 1 || parsedColourCount > 8) {
        return res.status(400).json({ message: 'Number of Colours must be between 1 and 8' });
      }
      task.colourCount = parsedColourCount;
    }

    if (req.file) {
      task.image_path = req.file.path.replace(/\\/g, '/');
    }

    task.status = task.status || 'pending';

    await task.save();

    await createAuditLog({
      req,
      action: 'edit',
      itemType: 'task',
      before,
      after: task.toObject()
    });

    res.json({ message: '✅ Task updated', task });
  } catch (err) {
    console.error('tasks edit error:', err);
    res.status(500).json({ message: 'Error updating task', details: err?.message || String(err) });
  }
});

// ❌ DELETE TASK (admin/ceo)
app.delete('/tasks/:id', verifyToken, allowRoles('admin', 'ceo'), async (req, res) => {
  try {
    const company = await getRequestCompany(req);

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).send('Task not found');
    if (task.company && task.company !== company) return res.status(403).send('Access denied');

    const before = task.toObject();
    await task.deleteOne();

    await createAuditLog({
      req,
      action: 'delete',
      itemType: 'task',
      before,
      after: null
    });

    res.json({ message: '✅ Task deleted' });
  } catch (err) {
    console.error('tasks delete error:', err);
    res.status(500).json({ message: 'Error deleting task', details: err?.message || String(err) });
  }
});

app.post('/tasks/:id/start', verifyToken, allowRoles('admin', 'manager', 'ceo', 'worker'), multer({ dest: './uploads/' }).single('foil_image'), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const taskCompany = task.company || 'bharath';
    if (taskCompany !== company) return res.status(403).json({ error: 'Access denied: Task belongs to different company' });
    if (task.status === 'completed') return res.status(400).json({ error: 'Cannot start a completed task' });

    const actorName = await getActorName(req);
    if (req.user.role === 'worker') {
      const taskWorkerName = (task.worker_name || '').trim();
      if (taskWorkerName === '') {
        task.worker_name = actorName;
      } else if (actorName !== taskWorkerName) {
        return res.status(403).json({ error: `You can only start your own tasks. Your name is "${actorName}" but task is assigned to "${taskWorkerName}"` });
      }
    }

    const colourCount = Number(task.colourCount || 1);
    const submittedScans = normalizeFoilScansInput(req.body, task);
    if (!Array.isArray(submittedScans) || submittedScans.length < colourCount) {
      return res.status(400).json({
        error: `Scan foil for each colour before starting. Required: ${colourCount}, received: ${submittedScans.length}`
      });
    }

    const usage = [];
    for (let colourNumber = 1; colourNumber <= colourCount; colourNumber += 1) {
      const scan = submittedScans.find((entry) => Number(entry.colourNumber) === colourNumber) || submittedScans[colourNumber - 1];
      const validation = await validateFoilForTask({ qrPayload: scan?.qrPayload, task, company, colourNumber, allowDuplicate: false });
      await QrScanLog.create({
        company,
        taskId: task._id,
        foilQrPayload: scan?.qrPayload || '',
        scannedBy: req.user.id,
        scannedByRole: req.user.role,
        validationResult: validation.ok ? 'valid' : validation.status,
        details: validation.ok ? `Colour ${colourNumber} foil accepted` : validation.message
      }).catch(() => {});
      if (!validation.ok) return res.status(403).json({ error: `Colour ${colourNumber}: ${validation.message}` });

      usage.push({
        foilId: validation.foil._id,
        foilQrPayload: validation.foil.qrPayload,
        colourNumber,
        startWeight: validation.balance,
        remainingWeight: validation.balance,
        usedWeight: 0,
        isSwap: false,
        scannedAt: new Date(),
        workerName: actorName
      });
    }

    if (req.file) task.foil_start_image_path = req.file.path.replace(/\\/g, '/');
    task.foilUsage = usage;
    task.foil_qrPayload = usage[0]?.foilQrPayload || '';
    task.status = 'in-progress';
    await task.save();

    await createAuditLog({
      req,
      action: 'start',
      itemType: 'task',
      before: null,
      after: task.toObject()
    });

    res.json({ message: `Task started with ${colourCount} foil scan${colourCount === 1 ? '' : 's'}`, task });
  } catch (err) {
    console.error('tasks start error:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});


app.post('/tasks/:id/foil-swap', verifyToken, allowRoles('admin', 'manager', 'ceo', 'worker'), async (req, res) => {
  try {
    const { colourNumber, foil_qrPayload, reason } = req.body;
    const company = await getRequestCompany(req);
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if ((task.company || 'bharath') !== company) return res.status(403).json({ error: 'Access denied: Task belongs to different company' });
    if (task.status !== 'in-progress') return res.status(400).json({ error: 'Foil swaps are available only for in-progress tasks' });

    const colour = Number(colourNumber);
    if (!Number.isInteger(colour) || colour < 1 || colour > Number(task.colourCount || 1)) {
      return res.status(400).json({ error: 'Invalid colour number' });
    }

    const matchingAvailable = await Foil.exists({
      company,
      type: task.foil_type,
      size: task.size,
      $or: [{ remainingWeight: { $gt: 0 } }, { weight: { $gt: 0 } }]
    });
    if (!matchingAvailable) {
      return res.status(404).json({ error: 'No matching foil available - contact Supervisor' });
    }

    const validation = await validateFoilForTask({ qrPayload: foil_qrPayload, task, company, colourNumber: colour, allowDuplicate: false });
    await QrScanLog.create({
      company,
      taskId: task._id,
      foilQrPayload: foil_qrPayload || '',
      scannedBy: req.user.id,
      scannedByRole: req.user.role,
      validationResult: validation.ok ? 'valid' : validation.status,
      details: validation.ok ? `Foil swap accepted for Colour ${colour}` : validation.message
    }).catch(() => {});
    if (!validation.ok) return res.status(403).json({ error: validation.message });

    const actorName = await getActorName(req);
    const previous = [...(task.foilUsage || [])].reverse().find((entry) => Number(entry.colourNumber) === colour);
    task.foilUsage.push({
      foilId: validation.foil._id,
      foilQrPayload: validation.foil.qrPayload,
      colourNumber: colour,
      startWeight: validation.balance,
      remainingWeight: validation.balance,
      usedWeight: 0,
      isSwap: true,
      swappedFromFoilId: previous?.foilId,
      scannedAt: new Date(),
      workerName: actorName,
      notes: reason || 'Foil ran out'
    });
    task.foilSwapEvents.push({
      colourNumber: colour,
      oldFoilId: previous?.foilId,
      newFoilId: validation.foil._id,
      reason: reason || 'Foil ran out',
      workerName: actorName
    });
    await task.save();

    await createAuditLog({ req, action: 'swap', itemType: 'task', before: null, after: task.toObject() });
    res.json({ message: `Foil swap recorded for Colour ${colour}`, task });
  } catch (err) {
    console.error('tasks foil-swap error:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});


app.post('/tasks/:id/consume', verifyToken, allowRoles('admin', 'manager', 'ceo', 'worker'), multer({ dest: './uploads/' }).single('waste_image'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { used_kg, waste_kg, remaining_kg } = req.body;
    const consumptionEntries = parseJsonField(req.body.foilUsage, []);

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const company = await getRequestCompany(req);
    if ((task.company || 'bharath') !== company) return res.status(403).json({ error: 'Access denied: Task belongs to different company' });
    if (task.status === 'completed') return res.status(400).json({ error: 'Task is already completed' });

    const actorName = await getActorName(req);
    if (req.user.role === 'worker') {
      const taskWorkerName = (task.worker_name || '').trim();
      if (taskWorkerName === '') {
        task.worker_name = actorName;
      } else if (actorName !== taskWorkerName) {
        return res.status(403).json({ error: `You can only complete your own tasks. Your name is "${actorName}" but task is assigned to "${taskWorkerName}"` });
      }
    }

    if (!Array.isArray(task.foilUsage) || task.foilUsage.length === 0) {
      return res.status(400).json({ error: 'Task has no scanned foil rolls. Start the task with foil scans first.' });
    }
    if (!Array.isArray(consumptionEntries) || consumptionEntries.length === 0) {
      return res.status(400).json({ error: 'Foil consumption per scanned roll is required' });
    }

    const beforeTask = task.toObject();
    let totalUsed = 0;
    const auditEvents = [];

    for (const entry of consumptionEntries) {
      const usage = task.foilUsage.id(entry.usageId);
      if (!usage) return res.status(400).json({ error: 'Invalid foil usage entry submitted' });

      const usedWeight = Number(entry.usedWeight ?? entry.usedKg ?? 0);
      if (!Number.isFinite(usedWeight) || usedWeight < 0) {
        return res.status(400).json({ error: 'Used foil weight must be zero or greater' });
      }

      const foil = await Foil.findOne({ _id: usage.foilId, company });
      if (!foil) return res.status(404).json({ error: `Foil not found for Colour ${usage.colourNumber}` });

      const beforeBalance = getFoilBalance(foil);
      if (usedWeight > beforeBalance) {
        return res.status(409).json({
          error: `Foil balance insufficient to complete Colour ${usage.colourNumber}. Please scan a new foil roll to continue.`,
          code: 'INSUFFICIENT_FOIL',
          colourNumber: usage.colourNumber,
          foilId: foil._id,
          availableWeight: beforeBalance
        });
      }

      const afterBalance = beforeBalance - usedWeight;
      setFoilBalance(foil, afterBalance);
      await foil.save();

      usage.usedWeight = Number((Number(usage.usedWeight || 0) + usedWeight).toFixed(3));
      usage.remainingWeight = Number(afterBalance.toFixed(3));
      usage.completedAt = new Date();
      totalUsed += usedWeight;

      auditEvents.push({
        action: 'consume',
        itemType: 'foil',
        company,
        itemId: String(foil._id),
        qrPayload: foil.qrPayload,
        changedBy: actorName,
        changedByRole: req.user.role,
        before: {
          taskId: String(task._id),
          colourNumber: usage.colourNumber,
          foilId: String(foil._id),
          weightBefore: beforeBalance
        },
        after: {
          taskId: String(task._id),
          colourNumber: usage.colourNumber,
          foilId: String(foil._id),
          weightUsed: usedWeight,
          weightRemaining: afterBalance,
          workerName: actorName,
          timestamp: new Date()
        }
      });
    }

    task.used_kg = Number(used_kg || totalUsed);
    task.waste_kg = Number(waste_kg || 0);
    task.remaining_kg = Number(remaining_kg || 0);
    task.status = 'completed';
    if (req.file) task.waste_image_path = req.file.path.replace(/\\/g, '/');
    await task.save();

    if (auditEvents.length) await AuditLog.insertMany(auditEvents);
    await createAuditLog({ req, action: 'complete', itemType: 'task', before: beforeTask, after: task.toObject() });

    res.json({ message: 'Task completed', task });
  } catch (err) {
    console.error('tasks consume error:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});


app.post('/tasks/:id/consume-legacy', verifyToken, allowRoles('admin', 'manager', 'ceo', 'worker'), multer({ dest: './uploads/' }).single('waste_image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { used_kg, waste_kg, remaining_kg } = req.body;

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const company = await getRequestCompany(req);
    const taskCompany = task.company || 'bharath';
    if (taskCompany !== company) {
      return res.status(403).json({ error: 'Access denied: Task belongs to different company' });
    }

    if (req.user.role === 'worker') {
      const user = await User.findById(req.user.id).select('name');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const workerName = (user.name || '').trim();
      const taskWorkerName = (task.worker_name || '').trim();
      
      if (taskWorkerName === '') {
        // Claim the unassigned task retroactively
        task.worker_name = workerName;
      } else if (workerName !== taskWorkerName) {
        return res.status(403).json({ 
          error: `You can only complete your own tasks. Your name is "${workerName}" but task is assigned to "${taskWorkerName}"` 
        });
      }
    }

    if (!req.file && req.user.role === 'worker') return res.status(400).json({ error: 'waste_image is required' });
    if (task.status === 'completed') return res.status(400).json({ error: 'Task is already completed' });

    task.used_kg = Number(used_kg);
    task.waste_kg = Number(waste_kg);
    task.remaining_kg = Number(remaining_kg);
    task.status = 'completed';
    if (req.file) {
      task.waste_image_path = req.file.path.replace(/\\/g, '/');
    }

    await task.save();

    // Update Foil Balance
    let newFoilQrPayload = null;
    if (task.foil_qrPayload) {
      const foil = await Foil.findOne({ qrPayload: task.foil_qrPayload });

      if (foil) {
        foil.weight = 0; // Old one is consumed
        await foil.save();

        if (Number(remaining_kg) > 0) {
          const newVersion = (foil.version || 1) + 1;
          newFoilQrPayload = generateFoilQrPayload({
            company: foil.company,
            type: foil.type,
            size: foil.size,
            kg: Number(remaining_kg),
            version: newVersion
          });
          const newFoil = new Foil({
            company: foil.company,
            materialKind: foil.materialKind,
            type: foil.type,
            size: foil.size,
            weight: Number(remaining_kg),
            qrPayload: newFoilQrPayload,
            version: newVersion,
            serial: String(newVersion)
          });
          await newFoil.save();

        }
      }
    }

    await createAuditLog({
      req,
      action: 'complete',
      itemType: 'task',
      before: null,
      after: task.toObject()
    });

    res.json({ message: '✅ Task completed', task, newFoilQrPayload });

  } catch (err) {
    console.error('tasks consume error:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});

// ========== ATTENDANCE SYSTEM ==========
const Attendance = require("./models/Attendance");

// Standard shift length in hours
const STANDARD_SHIFT_HOURS = Number(process.env.STANDARD_SHIFT_HOURS || 9);

function parseTimeString(timeStr) {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m, s: s || 0 };
}

// Helper: calculate hours between two HH:MM:SS strings
function calcHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const start = parseTimeString(checkIn);
  const end = parseTimeString(checkOut);
  if (!start || !end) return 0;
  const startSeconds = start.h * 3600 + start.m * 60 + start.s;
  const endSeconds = end.h * 3600 + end.m * 60 + end.s;
  const diff = Math.max(0, endSeconds - startSeconds);
  return Math.round((diff / 3600) * 100) / 100;
}

// Helper: calculate earnings based on hours, rate, and type
function calcEarnings(hours, rate, type) {
  if (!rate || rate <= 0) return 0;
  if (type === "hourly") return Math.round(hours * rate * 100) / 100;
  // daily: full day rate if >= 4 hrs, half if < 4 hrs
  if (hours >= 4) return rate;
  if (hours > 0) return Math.round(rate / 2 * 100) / 100;
  return 0;
}

// Helper: get the role of a user by name + company
async function getUserRoleByName(name, company) {
  const user = await User.findOne({ name, company }).select("role");
  return user?.role || "worker";
}

// GET all staff for the company (for attendance dropdown)
// Returns workers, managers — CEO sees everyone; Admin sees manager+worker; Manager sees worker only
app.get("/workers", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const requesterRole = req.user.role;

    let roleFilter;
    if (requesterRole === "ceo") {
      // CEO can see all staff
      roleFilter = { $in: ["worker", "manager", "admin"] };
    } else if (requesterRole === "admin") {
      // Admin can see workers and managers (not CEO)
      roleFilter = { $in: ["worker", "manager"] };
    } else {
      // Manager can see workers only
      roleFilter = "worker";
    }

    const staff = await User.find({ company, role: roleFilter }).select("name email role company employeeNo department shiftTiming");
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /attendance - Mark attendance
// Admin/Manager/CEO can mark, but only for users they have authority over
app.post("/attendance", verifyToken, async (req, res) => {
  try {
    const { workerName, date, status, notes, checkIn, checkOut, extraHours } = req.body;
    const company = await getRequestCompany(req);
    const requester = await User.findById(req.user.id).select("name role");
    const requesterRole = requester?.role;

    if (!workerName || !date) {
      return res.status(400).json({ error: "workerName and date are required" });
    }

    if (requesterRole === "worker" && workerName !== requester.name) {
      return res.status(403).json({ error: "Workers can only mark their own attendance" });
    }

    // Check authority: Admin cannot mark CEO attendance
    const targetRole = await getUserRoleByName(workerName, company);
    if (requesterRole === "admin" && targetRole === "ceo") {
      return res.status(403).json({ error: "Admin cannot manage CEO attendance" });
    }
    if (requesterRole === "manager" && (targetRole === "ceo" || targetRole === "admin")) {
      return res.status(403).json({ error: "Manager can only manage worker attendance" });
    }

    const now = new Date();
    const currentTime = now.toLocaleTimeString("en-GB", { hour12: false });
    const targetUser = await User.findOne({ name: workerName, company }).select("employeeNo salaryRate salaryType");
    if (targetUser && !targetUser.employeeNo) {
      targetUser.employeeNo = await getNextEmployeeNo(company);
      await targetUser.save();
    }
    const workerSalaryRate = targetUser?.salaryRate || 0;
    const workerSalaryType = targetUser?.salaryType || "daily";
    const empNo = req.body.empNo || targetUser?.employeeNo || "";
    const extra = Number(extraHours || 0);
    const normalizedStatus = (status || "present").toLowerCase();

    let record = await Attendance.findOne({ workerName, company, date });

    const shouldUseTimes = !["absent", "leave"].includes(normalizedStatus);
    const entryCheckIn = shouldUseTimes ? (checkIn || currentTime) : null;
    const entryCheckOut = shouldUseTimes ? (checkOut || null) : null;

    if (record) {
      if (["absent", "leave"].includes(normalizedStatus)) {
        record.status = normalizedStatus;
        record.checkIn = null;
        record.checkOut = null;
        record.extraHours = 0;
        record.hoursWorked = 0;
        record.overtime = 0;
        record.totalHours = 0;
        record.earnings = 0;
      } else {
        if (entryCheckIn) record.checkIn = entryCheckIn;
        if (entryCheckOut) record.checkOut = entryCheckOut;
        record.status = normalizedStatus;
        record.extraHours = extra;
        if (record.checkIn && record.checkOut) {
          record.hoursWorked = calcHours(record.checkIn, record.checkOut);
          record.overtime = Math.max(0, record.hoursWorked - STANDARD_SHIFT_HOURS);
          record.totalHours = Math.round((record.hoursWorked + extra) * 100) / 100;
          record.earnings = calcEarnings(record.hoursWorked, workerSalaryRate, workerSalaryType);
        } else {
          record.earnings = 0;
        }
      }
      if (notes !== undefined) record.remarks = notes;
      record.markedBy = requester?.name || "System";
      record.markedByRole = requester?.role || req.user.role;
      record.workerRole = targetRole;
      record.empNo = empNo;
      record.salaryRate = workerSalaryRate;
      record.salaryType = workerSalaryType;
      await record.save();
      return res.json({ message: "Attendance updated", record });
    }

    record = new Attendance({
      empNo,
      workerName,
      company,
      date,
      checkIn: entryCheckIn,
      checkOut: entryCheckOut,
      status: normalizedStatus,
      extraHours: extra,
      remarks: notes || "",
      markedBy: requester?.name || "System",
      markedByRole: requester?.role || req.user.role,
      workerRole: targetRole,
      salaryRate: workerSalaryRate,
      salaryType: workerSalaryType
    });

    if (record.checkIn && record.checkOut) {
      record.hoursWorked = calcHours(record.checkIn, record.checkOut);
      record.overtime = Math.max(0, record.hoursWorked - STANDARD_SHIFT_HOURS);
      record.totalHours = Math.round((record.hoursWorked + extra) * 100) / 100;
      record.earnings = calcEarnings(record.hoursWorked, workerSalaryRate, workerSalaryType);
    } else {
      record.earnings = 0;
    }

    await record.save();
    res.json({ message: "Attendance marked", record });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Attendance already marked for this worker on this date" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /attendance/:id - Edit attendance
// CEO: can edit all. Admin: can edit manager+worker only. Manager: NO edit access.
app.put("/attendance/:id", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  try {
    const { status, checkIn, checkOut, notes, extraHours, empNo } = req.body;
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });

    const requesterRole = req.user.role;
    const targetRole = await getUserRoleByName(record.workerName, record.company);
    if (requesterRole === "admin" && targetRole === "ceo") {
      return res.status(403).json({ error: "Admin cannot edit CEO attendance" });
    }

    const marker = await User.findById(req.user.id).select("name role");

      if (status) record.status = status.toLowerCase();
    if (empNo !== undefined) record.empNo = empNo;
    if (checkIn !== undefined) record.checkIn = checkIn;
    if (checkOut !== undefined) record.checkOut = checkOut;
    if (extraHours !== undefined) record.extraHours = Number(extraHours || 0);
    if (notes !== undefined) record.remarks = notes;
    record.markedBy = marker?.name || "System";
    record.markedByRole = marker?.role || req.user.role;

    if (["absent", "leave"].includes(record.status)) {
      record.checkIn = null;
      record.checkOut = null;
      record.hoursWorked = 0;
      record.overtime = 0;
      record.totalHours = 0;
      record.extraHours = 0;
      record.earnings = 0;
    } else if (record.checkIn && record.checkOut) {
      record.hoursWorked = calcHours(record.checkIn, record.checkOut);
      record.overtime = Math.max(0, record.hoursWorked - STANDARD_SHIFT_HOURS);
      record.totalHours = Math.round((record.hoursWorked + (record.extraHours || 0)) * 100) / 100;
      record.earnings = calcEarnings(record.hoursWorked, record.salaryRate, record.salaryType);
    } else {
      record.earnings = 0;
    }

    await record.save();
    res.json({ message: "Attendance updated", record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /attendance
app.get("/attendance", verifyToken, async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const { date, from, to, workerName, status } = req.query;

    let query = { company };

    if (workerName) query.workerName = workerName;
  if (req.query.empNo) query.empNo = req.query.empNo;

    if (date) {
      query.date = date;
    } else if (from && to) {
      query.date = { $gte: from, $lte: to };
    }

    if (!["admin", "manager", "ceo"].includes(req.user.role)) {
      const self = await User.findById(req.user.id).select("name");
      query.workerName = self?.name;
    }

    const records = await Attendance.find(query).sort({ date: -1, workerName: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /attendance/export
app.get("/attendance/export", verifyToken, async (req, res) => {
  try {
    const company = await getRequestCompany(req);
    const { type = "xlsx", date, from, to, workerName, status } = req.query;
    let query = { company };
    if (workerName) query.workerName = workerName;
    if (req.query.empNo) query.empNo = req.query.empNo;
    if (status) query.status = status.toLowerCase();
    if (date) query.date = date;
    else if (from && to) query.date = { $gte: from, $lte: to };
    if (!["admin", "manager", "ceo"].includes(req.user.role)) {
      const self = await User.findById(req.user.id).select("name");
      query.workerName = self?.name;
    }
    const records = await Attendance.find(query).sort({ workerName: 1, date: 1 });

    if (type === "pdf") {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=attendance_report.pdf`);
      doc.fontSize(14).text("Attendance Report", { align: "center" }).moveDown(0.5);
      doc.fontSize(10).text(`Date range: ${from || "All"} to ${to || "All"}`);
      if (workerName) doc.text(`Employee: ${workerName}`);
      doc.moveDown(0.5);

      const tableHeaders = ["Emp No", "Name", "Date", "Day", "Status", "Time In", "Time Out", "OD", "Hours", "OT", "Total"];
      const maxWidth = 520;
      const colWidth = maxWidth / tableHeaders.length;

      tableHeaders.forEach((header, index) => {
        doc.font("Helvetica-Bold").fontSize(8).text(header, 40 + index * colWidth, doc.y, { width: colWidth, continued: index !== tableHeaders.length - 1 });
      });
      doc.moveDown(1);

      records.forEach((rec) => {
        const day = new Date(rec.date).toLocaleDateString("en-GB", { weekday: "short" });
        const row = [rec.empNo || "", rec.workerName, rec.date, day, rec.status, rec.checkIn || "", rec.checkOut || "", rec.extraHours || 0, rec.hoursWorked || 0, rec.overtime || 0, rec.totalHours || 0];
        row.forEach((value, index) => {
          doc.font("Helvetica").fontSize(8).text(String(value), 40 + index * colWidth, doc.y, { width: colWidth, continued: index !== row.length - 1 });
        });
        doc.moveDown(0.8);
      });

      const summary = {};
      records.forEach((rec) => {
        const key = rec.empNo || rec.workerName;
        if (!summary[key]) summary[key] = { empNo: rec.empNo || "", name: rec.workerName, present: 0, absent: 0, od: 0, hours: 0, overtime: 0 };
        if (rec.status === "present") summary[key].present += 1;
        if (rec.status === "absent") summary[key].absent += 1;
        summary[key].od += rec.extraHours || 0;
        summary[key].hours += rec.hoursWorked || 0;
        summary[key].overtime += rec.overtime || 0;
      });

      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text("Summary", { underline: true }).moveDown(0.5);
      Object.values(summary).forEach((item) => {
        doc.fontSize(10).text(`${item.empNo} ${item.name} — Present: ${item.present}, Absent: ${item.absent}, OD Hours: ${item.od}, Working Hours: ${item.hours}, Overtime: ${item.overtime}`);
      });
      doc.pipe(res);
      doc.end();
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Attendance Report");
    sheet.columns = [
      { header: "Emp No", key: "empNo", width: 12 },
      { header: "Employee Name", key: "workerName", width: 24 },
      { header: "Date", key: "date", width: 14 },
      { header: "Day", key: "day", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Time In", key: "checkIn", width: 12 },
      { header: "Time Out", key: "checkOut", width: 12 },
      { header: "OD Hours", key: "extraHours", width: 12 },
      { header: "Working Hours", key: "hoursWorked", width: 14 },
      { header: "Overtime", key: "overtime", width: 12 },
      { header: "Total Hours", key: "totalHours", width: 14 },
      { header: "Remarks", key: "remarks", width: 24 }
    ];

    records.forEach((rec) => {
      const day = new Date(rec.date).toLocaleDateString("en-GB", { weekday: "short" });
      const row = sheet.addRow({
        empNo: rec.empNo || "",
        workerName: rec.workerName,
        date: rec.date,
        day,
        status: rec.status,
        checkIn: rec.checkIn ? { formula: `TIME(${rec.checkIn.split(":")[0]},${rec.checkIn.split(":")[1]},${rec.checkIn.split(":")[2] || 0})` } : "",
        checkOut: rec.checkOut ? { formula: `TIME(${rec.checkOut.split(":")[0]},${rec.checkOut.split(":")[1]},${rec.checkOut.split(":")[2] || 0})` } : "",
        extraHours: rec.extraHours || 0,
        hoursWorked: rec.hoursWorked || 0,
        overtime: rec.overtime || 0,
        totalHours: rec.totalHours || 0,
        remarks: rec.remarks || ""
      });
      if (rec.checkIn) row.getCell("checkIn").numFmt = "hh:mm:ss";
      if (rec.checkOut) row.getCell("checkOut").numFmt = "hh:mm:ss";
    });

    const summaryHeader = sheet.addRow([]);
    sheet.addRow([]);
    const summaryStart = sheet.addRow(["Summary"]);
    summaryStart.font = { bold: true };
    sheet.addRow(["Emp No", "Employee Name", "Total Present", "Total Absent", "Total OD Hours", "Total Working Hours", "Total Overtime"]);

    const employeeSummary = {};
    records.forEach((rec) => {
      const key = rec.empNo || rec.workerName;
      if (!employeeSummary[key]) {
        employeeSummary[key] = {
          empNo: rec.empNo || "",
          name: rec.workerName,
          present: 0,
          absent: 0,
          odHours: 0,
          workingHours: 0,
          overtime: 0
        };
      }

      if (rec.status === "present") employeeSummary[key].present += 1;
      if (rec.status === "absent") employeeSummary[key].absent += 1;
      employeeSummary[key].odHours += rec.extraHours || 0;
      employeeSummary[key].workingHours += rec.hoursWorked || 0;
      employeeSummary[key].overtime += rec.overtime || 0;
    });

    Object.values(employeeSummary).forEach((employee) => {
      sheet.addRow([
        employee.empNo,
        employee.name,
        employee.present,
        employee.absent,
        employee.odHours,
        employee.workingHours,
        employee.overtime
      ]);
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=attendance_report.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /attendance/:id
// CEO: can delete all. Admin: can delete manager+worker only. Manager: NO delete access.
app.delete("/attendance/:id", verifyToken, allowRoles("admin", "ceo"), async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });

    const requesterRole = req.user.role;
    const targetRole = await getUserRoleByName(record.workerName, record.company);

    if (requesterRole === "admin" && targetRole === "ceo") {
      return res.status(403).json({ error: "Admin cannot delete CEO attendance" });
    }

    await Attendance.findByIdAndDelete(req.params.id);
    res.json({ message: "Attendance record deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5001;

connectDatabase().then(() => {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}).catch((err) => {
  console.error("Failed to start server:", err.message || err);
});
