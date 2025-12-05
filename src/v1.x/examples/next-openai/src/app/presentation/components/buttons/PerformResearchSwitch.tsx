interface PerformResearchSwitchProps {
  isEnabled: boolean;
  setIsEnabled: (fn: (b: boolean) => boolean) => void;
}

export const PerformResearchSwitch = ({ isEnabled, setIsEnabled }: PerformResearchSwitchProps) => {
  return (
    <label className="flex items-center cursor-pointer pl-4">
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={isEnabled}
          onChange={() => setIsEnabled((b) => !b)}
        />
        <div
          className={`w-10 h-4 ${
            isEnabled ? "bg-blue-500" : "bg-gray-400"
          } rounded-full shadow-inner transition-colors`}
        ></div>

        <div
          className={`absolute w-6 h-6 bg-white rounded-full shadow -left-1 -top-1 transition-transform ${
            isEnabled ? "transform translate-x-full" : ""
          }`}
        ></div>
      </div>
      <span className="text-sm font-normal ml-2">Perform Research?</span>
    </label>
  );
};
