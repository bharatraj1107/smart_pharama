const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    company: { type: String, index: true },

    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },

    // Deterministic chat/conversation key for a pair of users
    conversationId: { type: String, index: true, required: true },

    text: { type: String, required: true, trim: true },

    timestamp: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

// Avoid duplicates for same sender/text/timestamp (best-effort)
MessageSchema.index({ conversationId: 1, senderId: 1, receiverId: 1, timestamp: 1 });

module.exports = mongoose.model("Message", MessageSchema);

