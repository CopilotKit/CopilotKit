import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { EventCard } from '../components/EventCard';
import { Filter } from '../components/Filter';
import { Title } from '../components/Title';
import { CopilotBot } from '../components/Copilot/CopilotBot'; // Add a CopilotBot component
import { CATEGORIES, CATEGORY_ALL } from '../constants';
import {
  selectCategoryFilter,
  selectFilteredEvents,
} from '../redux/eventsSelectors';
import { setCategoryFilter, setEvents } from '../redux/eventsSlice'; // Import setEvents action

export const HomePage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const events = useSelector(selectFilteredEvents);
  const categoryFilter = useSelector(selectCategoryFilter);

  // Fetch events from the backend API
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('https://event-planner-73j2.onrender.com/api/events/');
        
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const data = await response.json();
        dispatch(setEvents(data)); // Dispatch the events to the Redux store
        console.log(data);
      } catch (error) {
        console.error('Failed to fetch events:', error);
      }
    };

    fetchEvents();
  }, [dispatch]); // Only run once when the component mounts

  return (
    <>
      <div className="container py-10">
        <div>
          <div className="mb-10 flex justify-end gap-6 md:mb-5 xl:mb-10">
            <Title className="hidden xl:mr-auto xl:block text-black">My events</Title>
            <Filter
              className="md:min-w-[146px]"
              value={categoryFilter}
              noneOption={CATEGORY_ALL}
              options={CATEGORIES}
              icon="filters-3"
              placeholder="Category"
              onChange={value => dispatch(setCategoryFilter(value))}
            />
            <Button size="lg" icon="plus" style={{ backgroundColor: 'purple', color: 'white' }} onClick={() => navigate('/create')}>
              Add new event
            </Button>
          </div>
          <Title className="mb-5 hidden md:block xl:hidden">My events</Title>
        </div>

        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {events.length > 0 ? ( // Check if there are events to display
            events.map(event => (
              <EventCard key={event.id} event={event} />
            ))
          ) : (
            <li>No events found.</li> // Fallback if no events are available
          )}
        </ul>
      </div>

      {/* Copilot Bot Section */}
      <div className="fixed bottom-5 right-5" style={{ backgroundColor: 'purple', color: 'white' }}>
        <CopilotBot className="fixed bottom-5 right-5 bg-black text-white p-4 rounded-lg shadow-lg " />
      </div>
    </>
  );
};
