interface PerformResearchSwitchProps {
  isEnabled: boolean;
  setIsEnabled: (fn: (b: boolean) => boolean) => void;
}

export const PerformResearchSwitch = ({
  isEnabled,
  setIsEnabled,
}: PerformResearchSwitchProps) => {
  return (
    <label className="flex cursor-pointer items-center pl-4">
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={isEnabled}
          onChange={() => setIsEnabled((b) => !b)}
        />
        <div
          className={`h-4 w-10 ${
            isEnabled ? "bg-blue-500" : "bg-gray-400"
          } rounded-full shadow-inner transition-colors`}
        ></div>

        <div
          className={`absolute -left-1 -top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            isEnabled ? "translate-x-full transform" : ""
          }`}
        ></div>
      </div>
      <span className="ml-2 text-sm font-normal">Perform Research?</span>
    </label>
  );
};
