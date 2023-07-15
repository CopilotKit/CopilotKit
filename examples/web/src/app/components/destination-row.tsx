import React from "react";
import { Destination } from "./vacation-list";
import { useMakeCopilotReadable } from "@copilotkit/react-core";

export type DestinationRowProps = {
  destination: Destination;
  isChecked: boolean;
  onCheckChange: (isChecked: boolean) => void;
  parentCopilotPointer?: string;
};

export function DestinationRow({
  destination,
  isChecked,
  onCheckChange,
  parentCopilotPointer,
}: DestinationRowProps) {
  useMakeCopilotReadable(JSON.stringify(destination), parentCopilotPointer);

  return (
    <tr key={destination.name}>
      <td className="whitespace-nowrap py-5 pl-4 px-3 text-sm sm:pl-0">
        <div className="flex items-center">
          <div className="h-11 w-11 flex-shrink-0">
            <img
              className="h-11 w-11 rounded-full"
              src={destination.image}
              alt=""
            />
          </div>
          <div className="ml-4">
            <div className="font-medium text-gray-900">{destination.name}</div>
            <div className="mt-1 text-gray-500">{destination.country}</div>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap py-5 pl-4 pr-3 text-sm sm:pl-0 flex justify-center">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onCheckChange(event.target.checked)}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-5 text-sm text-gray-500">
        <div className="text-gray-900">{destination.description}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-5 text-sm text-gray-500">
        {destination.activities}
      </td>
    </tr>
  );
}
