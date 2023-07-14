import React from "react";
import { DestinationRow } from "./destination-row";
import { Destination } from "./vacation-list";
import { useMakeCopilotReadable } from "@copilotkit/react-core";

export type DestinationTableProps = {
  destinations: Destination[];
  heading: string;
};

function Thead() {
    return (
        <thead>
          <tr>
            <th
              scope="col"
              className="py-3.5 pl-4 px-3 text-left text-sm font-semibold text-gray-900 sm:pl-0"
            >
              Destination
            </th>
            <th
              scope="col"
              className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0"
            >
              Selected
            </th>
            <th
              scope="col"
              className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
            >
              Description
            </th>
            <th
              scope="col"
              className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
            >
              Activities
            </th>
          </tr>
        </thead>
        );
        
}

export function DestinationTable({
    destinations,
    heading,
  }: DestinationTableProps) {
    const [checkedRows, setCheckedRows] = React.useState<Record<string, boolean>>({});
  
    const handleCheckChange = (destinationName: string, isChecked: boolean) => {
      setCheckedRows(prevState => ({ ...prevState, [destinationName]: isChecked }));
    };
  
    return (
      <div>
        <h2 className="text-lg font-semibold leading-6 text-gray-900 mb-4 p-2">
          {heading}
        </h2>
        <table className="min-w-full divide-y divide-gray-300">
        <Thead />
          <tbody className="divide-y divide-gray-200 bg-white">
            {destinations.map((destination) => (
              <DestinationRow
                destination={destination}
                isChecked={!!checkedRows[destination.name]}
                onCheckChange={isChecked => handleCheckChange(destination.name, isChecked)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  
