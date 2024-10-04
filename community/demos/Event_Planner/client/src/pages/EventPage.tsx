import { BackLink } from '../components/BackLink';
import { EventDetails } from '../components/EventDetails';
import { Title } from '../components/Title';
import { useEventFromId } from '../hooks/useEventFromId';

export const EventPage = () => {
  const { event, loading } = useEventFromId(); // Use loading to handle loading state

  if (loading) {
    return <div>Loading event...</div>; // Display loading indicator
  }

  return (
    <div className="bg bg-cover">
      <div className="container py-10">
        <BackLink />
        {event ? (
          <div className="mx-auto xl:max-w-[688px]">
            <Title className="mb-6 xl:mb-4">{event.title}</Title>
            <EventDetails/> {/* Pass the event data */}
          </div>
        ) : (
          <div>Event not found</div> // Display error if event is not available
        )}
      </div>
    </div>
  );
};
