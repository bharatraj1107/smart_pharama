const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  workerName: { type: String, required: true },
  company: { type: String, required: true },
  date: { type: String, required: true },
  checkIn: { type: String, default: null },
  checkOut: { type: String, default: null },
  status: { type: String, enum: ["present", "absent", "half-day", "late"], default: "present" },
  markedBy: { type: String },
  markedByRole: { type: String },
  workerRole: { type: String, default: "worker" },
  hoursWorked: { type: Number, default: 0 },
  earnings: { type: Number, default: 0 },
  salaryRate: { type: Number, default: 0 },
  salaryType: { type: String, default: "daily" },
  notes: { type: String, default: "" }
}, { timestamps: true });

attendanceSchema.index({ workerName: 1, company: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
