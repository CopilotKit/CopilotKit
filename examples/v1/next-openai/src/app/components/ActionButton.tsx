export const ActionButton = ({
  disabled,
  onClick,
  className,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <button
      disabled={disabled}
      className={`rounded bg-blue-500 px-4 py-2 font-bold text-white ${disabled ? "cursor-not-allowed opacity-50" : "hover:bg-blue-700"} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
