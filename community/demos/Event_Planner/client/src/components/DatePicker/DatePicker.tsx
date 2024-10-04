import { Popover } from '@headlessui/react';
import clsx from 'clsx';
import { useState } from 'react';
import { formatDate } from '../../helpers';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Calendar } from './Calendar';

interface DatePickerProps {
  className?: string;
  label?: string;
  value: number;
  onChange?: (value: number) => void;
}

export function DatePicker({
  className,
  label = 'Select Date',
  value,
  onChange,
}: DatePickerProps) {
  const [selectedDate, setSelectedDate] = useState(new Date(value));

  const handleChange = () => {
    const newDate = new Date(value);
    newDate.setFullYear(selectedDate.getFullYear());
    newDate.setMonth(selectedDate.getMonth());
    newDate.setDate(selectedDate.getDate());
    onChange?.(newDate.getTime());
  };

  const handleCancel = () => {
    setSelectedDate(new Date(value));
  };

  return (
    <Popover className={clsx('relative flex flex-col gap-2 text-black', className)}>
      <span className="leading-none text-accent transition-opacity ui-open:opacity-0 text-black" >
        {label}
      </span>

      <Popover.Button style={{ backgroundColor: 'white', color: 'black' }} className="flex items-center justify-between gap-2 rounded-md border border-divider px-3 py-4 outline-none transition-colors focus:border-accent ui-open:border-accent ui-open:text-accent text-black">
        {({ open }) => (
          <>
            {open ? label : formatDate(value)}
            <Icon
              className="text-accent transition-transform ui-open:-scale-y-100 text-black"
              name="chevron-down"
            />
          </>
        )}
      </Popover.Button>

      <Popover.Panel className="absolute inset-x-0 -bottom-2 z-40 translate-y-full space-y-4 rounded-lg bg-white p-5 shadow-sm outline-none text-black">
        {({ close }) => (
          <>
            <Calendar selectedDate={selectedDate} onSelect={setSelectedDate} />

            <div className="flex justify-end gap-4">
              <Button
                variant="secondary"
                size="sm"
                style={{ color: 'black' }}
                onClick={() => {
                  handleCancel();
                  close();
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                style={{ backgroundColor: 'purple', color: 'white' }}
                onClick={() => {
                  handleChange();
                  close();
                }}
              >
                Choose date
              </Button>
            </div>
          </>
        )}
      </Popover.Panel>
    </Popover>
  );
}
