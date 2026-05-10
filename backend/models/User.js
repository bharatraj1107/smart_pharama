const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: String, // ceo, admin, manager, worker
  company: String, // bharath, shree_ganaapathy, vel
  phone: { type: String, default: "" },
  dob: { type: String, default: "" },         // YYYY-MM-DD
  joiningDate: { type: String, default: "" },  // YYYY-MM-DD
  age: { type: String, default: "" },
  idProofType: { type: String, default: "" },  // aadhar, pan
  idProofNumber: { type: String, default: "" },
  address: { type: String, default: "" },
  emergencyContact: { type: String, default: "" },
  profilePhoto: { type: String, default: "" },
  salaryRate: { type: Number, default: 0 },       // amount per hour or day
  salaryType: { type: String, enum: ["hourly", "daily"], default: "daily" },
  currency: { type: String, default: "INR" }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
