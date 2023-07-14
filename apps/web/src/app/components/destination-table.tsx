import React from "react";
import { DestinationRow } from "./destination-row";
import { Destination } from "./vacation-list";

export type DestinationTableProps = {
  destinations: Destination[];
  heading: string;
};

export function DestinationTable({
  destinations,
  heading,
}: DestinationTableProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold leading-6 text-gray-900 mb-4 p-2">
        {heading}
      </h2>
      <table className="min-w-full divide-y divide-gray-300">
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
        <tbody className="divide-y divide-gray-200 bg-white">
          {destinations.map((destination) => (
            <DestinationRow destination={destination} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
