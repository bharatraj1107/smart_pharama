const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  // New task creation fields
  product_name: String,
  image_path: String,
  foil_type: String,
  size: String,
  required_kg: Number,
  
  
  // Original fields
  foil_qrPayload: String,
  foil_start_image_path: String,

  // Assigned foil at task creation / validation
  assigned_foil_qrPayload: String,


  cylinder_barcode: String,
  // (Not converted to QR in this change; you only asked barcode system removal for foil/workflow.)

  worker_name: String,
  company: {
    type: String,
    default: 'bharath'
  },
  
  used_kg: Number,
  waste_kg: Number,
  remaining_kg: Number,
  
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in-progress', 'completed'],
    default: 'pending'
  }
}, { timestamps: true });

module.exports = mongoose.model("Task", taskSchema);

