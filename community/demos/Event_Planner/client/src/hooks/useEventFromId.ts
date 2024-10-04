import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Event } from '../interfaces';

export const useEventFromId = () => {
  const { id } = useParams<{ id: string }>(); // Get the event ID from the URL
  const [event, setEvent] = useState<Event | null>(null); // Use Event type
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const response = await axios.get(`https://event-planner-73j2.onrender.com/api/events/${id}`); // Ensure backend is returning the correct data
        setEvent(response.data); // Set the event data
      } catch (error) {
        console.error('Error fetching event:', error);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchEvent();
    }
  }, [id]);

  return { event, loading }; // Return both event and loading state
};
