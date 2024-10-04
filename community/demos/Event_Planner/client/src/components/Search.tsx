import clsx from 'clsx';
import { ComponentPropsWithoutRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectSearchKey } from '../redux/eventsSelectors';
import { clearSearchKey, setSearchKey } from '../redux/eventsSlice';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

interface SearchProps extends ComponentPropsWithoutRef<'input'> {}

export function Search({
  className,
  placeholder = 'Search by keywords',
  ...props
}: SearchProps) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const searchKey = useSelector(selectSearchKey);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate('/');
    }
  };

  return (
    <label className={clsx('relative', className)}>
      <input
        className="peer w-full text-black rounded-lg bg-white py-4 pl-12 pr-9 text-sm text-accent shadow-sm outline-none transition-colors placeholder:text-sm placeholder:font-light placeholder:text-neutral-light"
        placeholder={placeholder}
        value={searchKey}
        onChange={e => dispatch(setSearchKey(e.target.value))}
        onKeyDown={handleKeyDown}
        {...props}
      />
      <Icon
        className="absolute left-3 top-1/2 text-black -translate-y-1/2 text-accent"
        name="search"
      />
      <IconButton
        className="absolute right-3 top-1/2 -translate-y-1/2 text-accent transition-opacity peer-placeholder-shown:opacity-0"
        icon="cross"
        onClick={() => dispatch(clearSearchKey())}
      />
    </label>
  );
}
