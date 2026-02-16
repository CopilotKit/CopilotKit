export interface ChipWithIconProps {
  label: string;
  onDelete: () => void;
  iconUrl: string;
}

export const ChipWithIcon = ({
  label,
  onDelete,
  iconUrl,
}: ChipWithIconProps) => {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-white">
      {iconUrl && (
        <img src={iconUrl} alt="icon" className="mr-2 h-4 w-4 rounded-full" />
      )}
      {label}
      <button
        className="ml-2 text-white hover:text-gray-200 focus:outline-none"
        onClick={onDelete}
      >
        x
      </button>
    </span>
  );
};
