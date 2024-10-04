import clsx from 'clsx';
import { nanoid } from 'nanoid';
import { useController, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES, PRIORITIES } from '../constants';
import { getDefaultTime, getRandomPicrure } from '../helpers';
import { Event } from '../interfaces';
// import { createEvent, updateEvent } from '../redux/eventsSlice';
import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { TimePicker } from './TimePicker';
import axios from 'axios';


interface EventFormProps {
  className?: string;
  event?: Event;
}

type Inputs = Omit<Event, 'id'>;

export function EventForm({ className, event }: EventFormProps) {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    resetField,
    control,
    formState: { errors },
  } = useForm<Inputs>({
    defaultValues: {
      title: event?.title ?? '',
      description: event?.description ?? '',
      datetime: event?.datetime ?? getDefaultTime(),
      location: event?.location ?? '',
      category: event?.category ?? CATEGORIES[0],
      picture: event?.picture ?? '',
      priority: event?.priority ?? PRIORITIES[0],
    },
  });

  const datetimeController = useController({
    name: 'datetime',
    control,
  });
  const categoryController = useController({
    name: 'category',
    control,
  });
  const priorityController = useController({
    name: 'priority',
    control,
  });

  
  const onSubmit = async (data: Inputs) => {
    const id = event?.id ? event?.id : nanoid();
    const datetime = new Date(data.datetime); // Convert the timestamp to a Date object
    const eventData = {
      ...data,
      id,
      date: datetime.toISOString().split('T')[0], // Extract date in YYYY-MM-DD format
      time: datetime.toTimeString().split(' ')[0].substring(0, 5) // Extract time in HH:mm format
    };
  
    try {
      if (event) {
        // Update existing event
        await axios.put(`https://event-planner-73j2.onrender.com/api/events/${id}`, eventData);
      } else {
        eventData.picture = getRandomPicrure(id);
        // Create new event
        await axios.post('https://event-planner-73j2.onrender.com/api/events/', eventData);
      }
      navigate(`/`);
    } catch (error) {
      console.error('Error saving event:', error);
    }
  };
  
  

  return (
    <form
      className={clsx(
        'bg-white px-4 py-10 shadow-md md:px-6 xl:px-10',
        className,
      )}
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="mb-10 grid grid-cols-1 gap-5 md:grid-flow-col md:grid-cols-2 md:grid-rows-5 md:gap-x-6 xl:mb-15 xl:grid-cols-3 xl:grid-rows-3 xl:gap-x-10">
        <Input
          className='text-black'
          label="Title"
          {...register('title', { required: true })}
          onClear={() => resetField('title', { defaultValue: '' })}
          error={errors.title ? 'Title is required' : ''}
        />

        <Textarea
          className="row-span-2 text-black"
          label="Description"
          {...register('description')}
          onClear={() => resetField('description', { defaultValue: '' })}
        />

        <DatePicker
          className='text-black'
          value={datetimeController.field.value}
          onChange={datetimeController.field.onChange}
        />
        <TimePicker
          className='text-black'
          value={datetimeController.field.value}
          onChange={datetimeController.field.onChange}
        />

        <Input
          label="Location"
          {...register('location', { required: true })}
          onClear={() => resetField('location', { defaultValue: '' })}
          error={errors.location ? 'Location is required' : ''}
        />

        <Select
          className='text-black'
          label="Category"
          options={CATEGORIES}
          value={categoryController.field.value}
          onChange={categoryController.field.onChange}
        />


        <Select
          className='text-black'
          label="Priority"
          options={PRIORITIES}
          value={priorityController.field.value}
          onChange={priorityController.field.onChange}
        />
      </div>

      <Button
        className="w-full md:ml-auto md:w-auto md:min-w-[190px]"
        style={{ backgroundColor: 'purple', color: 'white' }}
        type="submit"
      >
        {event ? 'Save' : 'Add event'}
      </Button>
    </form>
  );
}
