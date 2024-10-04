import { BackLink } from '../components/BackLink';
import { EventForm } from '../components/EventForm';
import { Title } from '../components/Title';

export const CreateEventPage = () => {
  return (
    <div className="bg bg-cover">
      <div className="container py-10 ">
        <BackLink />
        <Title className="mb-6 xl:mb-4">Create New Event</Title>
        <EventForm />
      </div>
    </div>
  );
};
