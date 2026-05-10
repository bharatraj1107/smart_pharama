require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const User = require("./models/User");
const UserRequest = require("./models/UserRequest");
const Foil = require("./models/Foil");
const QrScanLog = require('./models/QrScanLog');
const { buildFoilQrPayload, parseFoilQrPayload } = require('./qr/qrPayload');

const Cylinder = require("./models/Cylinder");
const AuditLog = require("./models/AuditLog");
const Task = require("./models/Task");
const path = require("path");
const multer = require("multer");
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// QR routes
const qrRoutes = require('./routes/qrRoutes');
app.use('/qrs', qrRoutes);

app.get("/", (req, res) => {

  res.send("🚀 Smart Pharma Backend Running Successfully");
});

mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pharma")
  .then(() => console.log("DB Connected"));

const SECRET = process.env.JWT_SECRET || "MY_SECRET_KEY";

const COMPANY_NAMES = {
  bharath: "Bharath Enterprises",
  shree_ganaapathy: "Shree Ganaapathy Roto Prints",
  vel: "Vel Gravure"
};

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

// ========== PROFILE & STAFF ROUTES ==========

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
  const data = await UserRequest.find({ status: "pending", otpVerified: true });
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
    company: reqUser.company
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
    const { foil_qrPayload, cylinder_barcode, worker_name } = req.body;

    const company = await getRequestCompany(req);

    if (!worker_name || !worker_name.trim()) {
      return res.status(400).send("Worker name is required");
    }

    const task = new Task({
      foil_qrPayload,
      assigned_foil_qrPayload: foil_qrPayload,

      cylinder_barcode,
      worker_name: worker_name.trim(),
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
      qrPayload: generatedQrPayload,
      version: 1,
      serial
    });

    await foil.save();
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
      barcode: generatedBarcode
    });

    await cylinder.save();
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
app.get("/foils/barcode/:barcode", verifyToken, async (req, res) => {
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
    foil.weight = Number(weight);

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
    const { product_name, colors, size_inches, manufacturer } = req.body;
    const company = await getRequestCompany(req);

    if (!product_name || !colors || !size_inches || !manufacturer) {
      return res.status(400).send("Product, colors, size, and manufacturer are required");
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
    const { product_name, size, required_kg, company: bodyCompany, worker_name } = req.body;
    const company = bodyCompany || await getRequestCompany(req);

    if (!product_name || !size || !required_kg) {
      return res.status(400).send("Product name, size, required KG required");
    }
    if (!worker_name) {
      return res.status(400).send("Worker name is required");
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
    const { product_name, size, required_kg, company: bodyCompany } = req.body;
    const company = bodyCompany || await getRequestCompany(req);

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).send('Task not found');
    if (task.company && task.company !== company) return res.status(403).send('Access denied');

    const before = task.toObject();

    task.company = task.company || company;
    if (product_name !== undefined) task.product_name = product_name;
    if (size !== undefined) task.size = size;
    if (required_kg !== undefined) task.required_kg = Number(required_kg);

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
    const { foil_qrPayload } = req.body;

    if (!foil_qrPayload) {
      return res.status(400).json({ error: 'foil_qrPayload is required' });
    }


    const company = await getRequestCompany(req);
    const task = await Task.findById(req.params.id);

    const BarcodeScanLog = null; // removed barcode system
    const QrScanLog = require('./models/QrScanLog');


    if (!task) return res.status(404).json({ error: 'Task not found' });

    const taskCompany = task.company || 'bharath';
    if (taskCompany !== company) {
      return res.status(403).json({ error: 'Access denied: Task belongs to different company' });
    }

    if (task.status === 'completed') {
      return res.status(400).json({ error: 'Cannot start a completed task' });
    }

    // Strict QR checks (security)
    let validationResult = 'invalid';
    let details = '';

    if (!foil_qrPayload || !String(foil_qrPayload).trim()) {
      validationResult = 'invalid';
      details = 'foil_qrPayload is required';


    } else {
      // Enforce matching assigned foil if present
      const assigned = task.assigned_foil_qrPayload || task.foil_qrPayload || '';
      if (String(assigned).trim() && String(foil_qrPayload).trim() !== String(assigned).trim()) {
        validationResult = 'mismatch';
        details = `Scanned foil QR payload does not match assigned foil.`;
      } else {
        // QR payload must exist in stock and belong to this company
        const foil = await Foil.findOne({ qrPayload: foil_qrPayload, company });

        if (!foil) {
          validationResult = 'not-found';
      details = 'Foil QR payload not found in this company';

        } else if (Number(foil.weight) <= 0) {
          validationResult = 'consumed';
          details = 'Foil barcode already consumed/unavailable';
        } else {
          validationResult = 'valid';
        }
      }
    }

    // Log every attempt
    await QrScanLog.create({


      company,
      taskId: task._id,
      foilQrPayload: foil_qrPayload,

      scannedBy: req.user.id,
      scannedByRole: req.user.role,
      validationResult,
      details
    }).catch(() => {});

    if (validationResult !== 'valid') {
      return res.status(403).json({ error: `QR validation failed: ${details || validationResult}` });
    }


    // Worker ownership / claim
    if (req.user.role === 'worker') {
      const user = await User.findById(req.user.id).select('name');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const workerName = (user.name || '').trim();
      const taskWorkerName = (task.worker_name || '').trim();

      if (taskWorkerName === '') {
        task.worker_name = workerName;
      } else if (workerName !== taskWorkerName) {
        return res.status(403).json({
          error: `You can only start your own tasks. Your name is "${workerName}" but task is assigned to "${taskWorkerName}"`
        });
      }
    }

    if (req.file) {
      task.foil_start_image_path = req.file.path.replace(/\\/g, '/');
    }

    // Set current used foil QR payload on task
    task.foil_qrPayload = foil_qrPayload;

    task.status = 'in-progress';
    await task.save();

    await createAuditLog({
      req,
      action: 'start',
      itemType: 'task',
      before: null,
      after: task.toObject()
    });

    res.json({ message: 'Task started', task });
  } catch (err) {
    console.error('tasks start error:', err);
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});


app.post('/tasks/:id/consume', verifyToken, allowRoles('admin', 'manager', 'ceo', 'worker'), multer({ dest: './uploads/' }).single('waste_image'), async (req, res) => {
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

// Helper: calculate hours between two HH:MM:SS strings
function calcHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const [h1, m1, s1] = checkIn.split(":").map(Number);
  const [h2, m2, s2] = checkOut.split(":").map(Number);
  const start = h1 * 3600 + m1 * 60 + (s1 || 0);
  const end = h2 * 3600 + m2 * 60 + (s2 || 0);
  const diff = Math.max(0, end - start);
  return Math.round((diff / 3600) * 100) / 100; // 2 decimal places
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

    const staff = await User.find({ company, role: roleFilter }).select("name email role company");
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /attendance - Mark attendance
// Admin/Manager/CEO can mark, but only for users they have authority over
app.post("/attendance", verifyToken, allowRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const { workerName, date, status, notes, checkIn, checkOut } = req.body;
    const company = await getRequestCompany(req);
    const marker = await User.findById(req.user.id).select("name role");
    const requesterRole = req.user.role;

    if (!workerName || !date) {
      return res.status(400).json({ error: "workerName and date are required" });
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

    // Lookup worker's salary config
    const targetUser = await User.findOne({ name: workerName, company }).select("salaryRate salaryType");
    const workerSalaryRate = targetUser?.salaryRate || 0;
    const workerSalaryType = targetUser?.salaryType || "daily";

    let record = await Attendance.findOne({ workerName, company, date });

    if (record) {
      if (status === "absent") {
        record.status = "absent";
        record.checkIn = null;
        record.checkOut = null;
      } else if (checkOut || (!record.checkOut && record.checkIn)) {
        record.checkOut = checkOut || currentTime;
        record.status = status || record.status;
        // Calculate hours & earnings
        const hrs = calcHours(record.checkIn, record.checkOut);
        record.hoursWorked = hrs;
        record.earnings = calcEarnings(hrs, workerSalaryRate, workerSalaryType);
      } else {
        if (checkIn) record.checkIn = checkIn;
        if (status) record.status = status;
      }
      if (notes !== undefined) record.notes = notes;
      record.markedBy = marker?.name || "System";
      record.markedByRole = marker?.role || req.user.role;
      record.salaryRate = workerSalaryRate;
      record.salaryType = workerSalaryType;
      await record.save();
      return res.json({ message: "Attendance updated", record });
    }

    record = new Attendance({
      workerName,
      company,
      date,
      checkIn: status === "absent" ? null : (checkIn || currentTime),
      checkOut: checkOut || null,
      status: status || "present",
      markedBy: marker?.name || "System",
      markedByRole: marker?.role || req.user.role,
      workerRole: targetRole,
      salaryRate: workerSalaryRate,
      salaryType: workerSalaryType,
      notes: notes || ""
    });

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
    const { status, checkIn, checkOut, notes } = req.body;
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });

    const requesterRole = req.user.role;

    // Admin cannot edit CEO attendance
    const targetRole = await getUserRoleByName(record.workerName, record.company);
    if (requesterRole === "admin" && targetRole === "ceo") {
      return res.status(403).json({ error: "Admin cannot edit CEO attendance" });
    }

    const marker = await User.findById(req.user.id).select("name role");

    if (status) record.status = status;
    if (checkIn !== undefined) record.checkIn = checkIn;
    if (checkOut !== undefined) record.checkOut = checkOut;
    if (notes !== undefined) record.notes = notes;
    record.markedBy = marker?.name || "System";
    record.markedByRole = marker?.role || req.user.role;

    // Recalculate earnings if both check-in and check-out exist
    if (record.checkIn && record.checkOut) {
      const targetUser = await User.findOne({ name: record.workerName, company: record.company }).select("salaryRate salaryType");
      const rate = targetUser?.salaryRate || record.salaryRate || 0;
      const type = targetUser?.salaryType || record.salaryType || "daily";
      const hrs = calcHours(record.checkIn, record.checkOut);
      record.hoursWorked = hrs;
      record.earnings = calcEarnings(hrs, rate, type);
      record.salaryRate = rate;
      record.salaryType = type;
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
    const { date, from, to } = req.query;

    let query = { company };

    if (date) {
      query.date = date;
    } else if (from && to) {
      query.date = { $gte: from, $lte: to };
    } else {
      const today = new Date().toISOString().split("T")[0];
      query.date = today;
    }

    const records = await Attendance.find(query).sort({ date: -1, workerName: 1 });
    res.json(records);
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
app.listen(PORT, () => console.log(`Server running on ${PORT}`));


