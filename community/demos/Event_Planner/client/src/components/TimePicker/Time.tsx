import clsx from 'clsx';

export interface TimeParts {
  hours: number;
  minutes: number;
  isPM: boolean;
}

interface TimeProps {
  className?: string;
  timeParts: TimeParts;
  onChange: (timeParts: TimeParts) => void;
}

export function Time({
  className,
  timeParts: { hours, minutes, isPM },
  onChange,
}: TimeProps) {
  const prevHours = hours <= 1 ? 12 : hours - 1;
  const nextHours = hours >= 12 ? 1 : hours + 1;
  const prevMinutes = minutes <= 0 ? 59 : minutes - 1;
  const nextMinutes = minutes >= 59 ? 0 : minutes + 1;

  const handlePrevHour = () => {
    onChange({ hours: prevHours, minutes, isPM });
  };

  const handleNextHour = () => {
    onChange({ hours: nextHours, minutes, isPM });
  };

  const handlePrevMinutes = () => {
    onChange({ hours, minutes: prevMinutes, isPM });
  };

  const handleNextMinutes = () => {
    onChange({ hours, minutes: nextMinutes, isPM });
  };

  const switchAmPm = () => {
    onChange({ hours, minutes, isPM: !isPM });
  };

  return (
    <div
      className={clsx(
        'flex flex-col divide-y divide-divider text-center',
        className,
      )}
    >
      <div className="grid grid-cols-3 text-divider">
        <button className="p-3" type="button" onClick={handlePrevHour}>
          {prevHours.toString().padStart(2, '0')}
        </button>
        <button className="p-3" type="button" onClick={handlePrevMinutes}>
          {prevMinutes.toString().padStart(2, '0')}
        </button>
        {isPM && (
          <button className="p-3" type="button" onClick={switchAmPm}>
            AM
          </button>
        )}
      </div>
      <time className="grid grid-cols-3 font-semibold">
        <span className="relative p-3 after:absolute after:-right-px after:top-1/2 after:-translate-y-1/2 after:content-[':']">
          {hours.toString().padStart(2, '0')}
        </span>
        <span className="p-3">{minutes.toString().padStart(2, '0')}</span>
        <span className="p-3">{isPM ? 'PM' : 'AM'}</span>
      </time>
      <div className="grid grid-cols-3 text-divider">
        <button className="p-3" type="button" onClick={handleNextHour}>
          {nextHours.toString().padStart(2, '0')}
        </button>
        <button className="p-3" type="button" onClick={handleNextMinutes}>
          {nextMinutes.toString().padStart(2, '0')}
        </button>
        {!isPM && (
          <button className="p-3" type="button" onClick={switchAmPm}>
            PM
          </button>
        )}
      </div>
    </div>
  );
}
