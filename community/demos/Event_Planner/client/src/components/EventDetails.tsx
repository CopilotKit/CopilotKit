import clsx from 'clsx';
import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { formatDateTime, getChipVariant } from '../helpers';
import { Event } from '../interfaces';
import { deleteEvent as deleteEventAction } from '../redux/eventsSlice';
import { Button } from './Button';
import { Chip } from './Chip';

interface EventDetailsProps {
  className?: string;
}

export function EventDetails({ className }: EventDetailsProps) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>(); // Extract the event ID from the URL
  const [event, setEvent] = useState<Event | null>(null); // State to store event details
  const [loading, setLoading] = useState(true); // Loading state

  useEffect(() => {
    const fetchEventDetails = async () => {
      try {
        const response = await axios.get(`https://event-planner-73j2.onrender.com/api/events/${id}`); // Adjust the endpoint as needed
        setEvent(response.data); // Set the fetched event data
      } catch (error) {
        console.error('Error fetching event details:', error);
      } finally {
        setLoading(false); // Set loading to false after fetching
      }
    };

    fetchEventDetails();
  }, [id]);

  // Handle deletion of the event
  const handleDelete = async () => {
    try {
      await axios.delete(`https://event-planner-73j2.onrender.com/api/events/${id}`); // Delete the event from the backend
      dispatch(deleteEventAction(id as string)); // Dispatch the action to update the Redux state
      navigate('/'); // Navigate back to the events list
    } catch (error) {
      console.error('Error deleting event:', error);
      // Optionally, show an error message to the user
    }
  };

  // If the event is still loading, show a loading indicator or message
  if (loading) {
    return <div>Loading...</div>;
  }

  // If event is not found, display a message
  if (!event) {
    return <div>Event not found</div>;
  }

  

  const { title, description, date, time, location, category, picture, priority } = event;
  // Create a Date object from the date string
  const eventDate = new Date(date);
  
  // Combine the date and time to create a valid DateTime
  const eventDateTime = new Date(`${eventDate.toISOString().split('T')[0]}T${time}`);

  return (
    <div className={clsx('rounded-md bg-white shadow-sm', className)}>
      <img
        className="aspect-[16/10] w-full rounded-md object-cover md:aspect-[5/2]"
        src={picture}
        alt={title}
      />
      <div className="px-6 pb-10 pt-6">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <p className="mb-6 text-sm">{description}</p>
        <div className="mb-10 flex flex-wrap gap-3">
          <Chip className='text-black'>{category}</Chip>
          <Chip variant={getChipVariant(priority)}>{priority}</Chip>
          <Chip className='text-black'>{location}</Chip>
          <Chip className='text-black'>{formatDateTime(eventDateTime)}</Chip>
        </div>
        <div className="flex gap-6 md:justify-end md:gap-4">
          <Button
            className="basis-1/2 text-xs md:basis-auto md:text-sm text-black"
            variant="secondary"
            onClick={() => navigate(`/edit/${id}`)} // Navigate to edit page
          >
            Edit
          </Button>
          <Button
            className="basis-1/2 text-xs md:basis-auto md:text-sm"
            style={{ backgroundColor: 'purple', color: 'white' }}
            onClick={handleDelete} // Call handleDelete on click
          >
            Delete event
          </Button>
        </div>
      </div>
    </div>
  );
}
