import { Listbox } from '@headlessui/react';
import clsx from 'clsx';
import { Icon } from './Icon';

interface SelectProps {
  className?: string;
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange?: (value: string) => void;
}

export function Select({
  className,
  label,
  value,
  options,
  placeholder = 'Select',
  onChange,
}: SelectProps) {

  return (
    <Listbox
      as="div"
      className={clsx('relative flex flex-col gap-2 text-black', className)}
      value={value}
      onChange={onChange}
    >
      <span className="leading-none transition-opacity text-accent ui-open:opacity-0 text-black" >
        {label}
      </span>
      <Listbox.Button className="flex items-center justify-between gap-2 px-3 py-4 transition-colors border rounded-md outline-none border-divider focus:border-accent ui-open:border-accent ui-open:text-accent text-black" style={{ backgroundColor: 'white', color: 'black' }}>
        {({ open, value }) => (
          <>
            {open ? `${placeholder} ${label}` : value}
            <Icon
              className="transition-transform text-accent ui-open:-scale-y-100 text-black"
              name="chevron-down"
            />
          </>
        )}
      </Listbox.Button>
      <Listbox.Options className="absolute inset-x-0 z-40 px-3 translate-y-full bg-white divide-y rounded-md shadow-sm outline-none -bottom-2 divide-divider text-black">
        {options.map(option => (
          <Listbox.Option
            className="py-4 transition-colors cursor-pointer ui-selected:text-accent ui-active:text-accent"
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
