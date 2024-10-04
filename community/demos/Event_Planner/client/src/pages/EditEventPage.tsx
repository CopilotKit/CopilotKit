import { BackLink } from '../components/BackLink';
import { EventForm } from '../components/EventForm';
import { Title } from '../components/Title';
import { useEventFromId } from '../hooks/useEventFromId';

export const EditEventPage = () => {
  const { event, loading } = useEventFromId(); // Get the event and loading status

  if (loading) {
    return <div>Loading...</div>; // Show a loading indicator while fetching
  }

  if (!event) {
    return <div>Event not found</div>; // Show error if event is not found
  }

  return (
    <div className="bg bg-cover">
      <div className="container py-10">
        <BackLink />
        <Title className="mb-6 xl:mb-4">Edit Event</Title>
        <EventForm event={event} /> {/* Pass the event data to EventForm */}
      </div>
    </div>
  );
};
