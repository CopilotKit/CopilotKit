import clsx from "clsx";

interface NavButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function NavButton({ children, onClick, disabled }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "w-7 h-7 border border-white rounded-md flex justify-center items-center",
        "focus:outline-none",
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white hover:text-black",
      )}
    >
      {children}
    </button>
  );
}
