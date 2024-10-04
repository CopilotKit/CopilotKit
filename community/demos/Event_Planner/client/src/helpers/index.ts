import { ChipProps } from '../components/Chip';
import { TimeParts } from '../components/TimePicker/Time';
import { MONTHES } from '../constants';

export const getRandomPicrure = (seed: string) => {
  return `https://picsum.photos/seed/${seed}/640/640`;
};

export const getTimeParts = (time: Date | number): TimeParts => {
  const dateTime = new Date(time);
  const hours = dateTime.getHours() % 12 || 12;
  const minutes = dateTime.getMinutes();
  const isPM = dateTime.getHours() >= 12;
  return { hours, minutes, isPM };
};

export const formatDate = (date: Date | number) => {
  const dateTime = new Date(date);
  return dateTime.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

export const formatTime = (time: Date | number) => {
  const dateTime = new Date(time);
  return dateTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatDateTime = (date: Date | number) => {
  const dateTime = new Date(date);
  const dateStr = dateTime.toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
  });
  return `${dateStr} at ${formatTime(date)}`;
};

export const getDaysInMonth = (month: number, year: number) => {
  return new Date(year, month, 0).getDate();
};

export const getFirstWeekday = (month: number, year: number) => {
  return new Date(year, month, 1).getDay();
};

export const isDatesSame = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

export const formatMonth = (month: number) => {
  return MONTHES[month];
};

export const getDefaultTime = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9);
  date.setMinutes(0);
  date.setSeconds(0);
  return date.getTime();
};

export const getChipVariant = (priority: string): ChipProps['variant'] => {
  if (priority === 'Low') return 'low';
  if (priority === 'Medium') return 'medium';
  if (priority === 'High') return 'high';
};
