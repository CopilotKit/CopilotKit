import { Listbox } from '@headlessui/react';
import clsx from 'clsx';
import { IconName } from '../interfaces';
import { Icon } from './Icon';

interface FilterProps {
  className?: string;
  value: string;
  noneOption: string;
  options: string[];
  icon: IconName;
  placeholder: string;
  onChange?: (value: string) => void;
}

export function Filter({
  className,
  value,
  noneOption,
  options,
  icon,
  placeholder,
  onChange,
}: FilterProps) {
  return (
    <Listbox
      as="div"
      className={clsx('relative', className)}
      value={value}
      onChange={onChange}
    >
      <Listbox.Button className="w-full p-4 transition-colors bg-white shadow-sm outline-none rounded-t-md ui-not-open:rounded-b-md">
        {({ open, value }) => (
          <span
            className={clsx('flex items-center justify-between gap-2', {
              'text-accent': open || value !== noneOption,
            })}
          >
            {open || value === noneOption ? placeholder : value}
            <Icon name={icon} />
          </span>
        )}
      </Listbox.Button>
      <Listbox.Options className="absolute inset-x-0 bottom-0 z-40 translate-y-full bg-white shadow-sm outline-none rounded-b-md ">
        {[noneOption, ...options].map(option => (
          <Listbox.Option
            className="px-6 py-2 text-sm transition-colors border-t cursor-pointer border-t-divider text-divider ui-selected:text-accent ui-active:text-accent"
            key={option}
            value={option}
          >
            {option}
          </Listbox.Option>
        ))}
      </Listbox.Options>
    </Listbox>
  );
}
