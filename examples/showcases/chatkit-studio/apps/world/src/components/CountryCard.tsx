/**
 * Country info card rendered by the agent's renderCountry action.
 */

interface CountryCardProps {
  countryName: string;
  capital?: string;
  flagEmoji?: string;
  points?: number;
}

export default function CountryCard({ countryName, capital, flagEmoji, points = 1 }: CountryCardProps) {
  return (
    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-3xl px-4 py-3 shadow-sm">
      {/* Flag Section */}
      <div className="flex items-center gap-3 flex-1">
        {flagEmoji && <div className="text-4xl flex-shrink-0">{flagEmoji}</div>}

        {/* Country Info */}
        <div className="flex flex-col">
          <h3 className="text-base font-semibold text-gray-900 leading-tight">{countryName}</h3>
          {capital && <p className="text-sm text-gray-500 mt-0.5">{capital}</p>}
        </div>
      </div>

      {/* Points Badge */}
      <div className="flex-shrink-0 bg-green-100 text-green-700 text-sm font-medium px-3 py-1 rounded-full">
        +{points} {points === 1 ? "point" : "points"}
      </div>
    </div>
  );
}
