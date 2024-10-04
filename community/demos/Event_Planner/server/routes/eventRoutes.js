const express = require('express');
const { getEvents, createEvent,getEventById, updateEvent, deleteEvent } = require('../controllers/eventController');

const router = express.Router();

// Routes for event CRUD operations
router.get('/', getEvents);
router.get('/:id', getEventById);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

module.exports = router;
