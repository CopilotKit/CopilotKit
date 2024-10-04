import clsx from 'clsx';

interface TitleProps {
  className?: string;
  children: string;
}

export const Title = ({ children, className }: TitleProps) => {
  return (
    <h1
      className={clsx(
        'text-lg font-semibold text-neutral md:text-xl text-black',
        className,
      )}
    >
      {children}
    </h1>
  );
};
