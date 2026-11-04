"use client";

/**
 * Tooltip for selected country with visit button.
 */

interface CountryTooltipProps {
  countryName: string;
  flagEmoji: string | null;
  position: { x: number; y: number };
  isVisited: boolean;
  onVisit: (countryName: string, flagEmoji: string | null) => void;
}

const CountryTooltip = ({
  countryName,
  flagEmoji,
  position,
  isVisited,
  onVisit,
}: CountryTooltipProps) => {
  return (
    <div
      className="fixed z-50 pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translate(-50%, -120%)",
      }}
    >
      <div className="">
        {/* Image/Flag section */}
        <div className="bg-black/80 text-white p-0 flex items-center justify-center rounded-4xl px-2 py-1">
          {flagEmoji ? (
            <>
              <span className="text-3xl mr-2">{flagEmoji}</span>{" "}
              <span>{countryName}</span>
            </>
          ) : (
            <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center">
              <span className="text-gray-400 text-2xl">🌍</span>
            </div>
          )}
        </div>
      </div>

      {/* Country name and button */}
      {!isVisited ? (
        <button
          onClick={() => onVisit(countryName, flagEmoji)}
          className="w-full bg-white text-black font-medium py-1 px-0 rounded-2xl transition-colors duration-200 mt-2 text-sm cursor-pointer hover:bg-gray-100"
        >
          Visit
        </button>
      ) : (
        <div className="w-full bg-green-500 text-white font-medium py-1 px-0 rounded-2xl mt-2 text-sm text-center">
          ✓ Visited
        </div>
      )}
    </div>
  );
};

export default CountryTooltip;
