const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ["create", "edit", "delete", "start", "complete"],
    required: true
  },
  itemType: {
    type: String,
    enum: ["foil", "cylinder", "task"],
    required: true
  },
  company: String,
  itemId: String,
  barcode: String,
  changedBy: String,
  changedByRole: String,
  before: Object,
  after: Object,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
