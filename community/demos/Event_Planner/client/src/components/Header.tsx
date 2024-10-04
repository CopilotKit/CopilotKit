import { Link } from 'react-router-dom';
import { Search } from './Search';

export const Header = () => {
  return (
    <header className="border-b border-b-accent bg-white">
      <div className="container flex flex-col gap-8 py-6 md:flex-row md:items-center md:justify-between">
        <Link to="/" className="font-secondary text-lg text-accent text-black" >
          Event Planner
        </Link>
        <Search className="min-w-full md:min-w-[368px] xl:min-w-[410px]" />
      </div>
    </header>
  );
};
