const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true }, // Store the date
  time: { type: String, required: true }, // Store time separately as a string (HH:mm format)
  location: { type: String, required: true },
  category: { type: String, required: true },
  picture: { type: String },
  priority: { type: String, required: true },
});

module.exports = mongoose.model('Event', eventSchema);
