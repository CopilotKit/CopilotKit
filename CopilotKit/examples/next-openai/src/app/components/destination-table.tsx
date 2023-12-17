"use client";

import React from "react";
import { DestinationRow } from "./destination-row";
import { Destination } from "./vacation-list";
import { useMakeCopilotActionable, useMakeCopilotReadable } from "@copilotkit/react-core";

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
        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
          Description
        </th>
        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
          Activities
        </th>
      </tr>
    </thead>
  );
}

export function DestinationTable({ destinations, heading }: DestinationTableProps) {
  const copilotPointer = useMakeCopilotReadable(heading);

  const [checkedRows, setCheckedRows] = React.useState<Record<string, boolean>>({});
  const handleCheckChange = (destinationName: string, isChecked: boolean) => {
    setCheckedRows((prevState) => ({
      ...prevState,
      [destinationName]: isChecked,
    }));
  };

  useMakeCopilotActionable(
    {
      name: `selectDestinations_${toCamelCase(heading)}`,
      description: `Set the given destinations as 'selected', on the ${heading} table`,
      argumentAnnotations: [
        {
          name: "destinationNames",
          type: "array",
          items: {
            type: "string",
          },
          description: "The names of the destinations to select",
          required: true,
        },
      ],
      implementation: async (destinationNames: string[]) => {
        setCheckedRows((prevState) => {
          const newState = { ...prevState };
          destinationNames.forEach((destinationName) => {
            newState[destinationName] = true;
          });
          return newState;
        });
      },
    },
    [],
  );

  useMakeCopilotActionable(
    {
      name: `deselectDestinations_${toCamelCase(heading)}`,
      description: `Set the given destinations as de-selected (unselected), on the ${heading} table`,
      argumentAnnotations: [
        {
          name: "destinationNames",
          type: "array",
          items: {
            type: "string",
          },
          description: "The names of the destinations to de-select",
          required: true,
        },
      ],
      implementation: async (destinationNames: string[]) => {
        setCheckedRows((prevState) => {
          const newState = { ...prevState };
          destinationNames.forEach((destinationName) => {
            newState[destinationName] = false;
          });
          return newState;
        });
      },
    },
    [],
  );

  return (
    <div>
      <h2 className="text-lg font-semibold leading-6 text-gray-900 mb-4 p-2">{heading}</h2>
      <table className="min-w-full divide-y divide-gray-300">
        <Thead />
        <tbody className="divide-y divide-gray-200 bg-white">
          {destinations.map((destination) => (
            <DestinationRow
              key={destination.name}
              destination={destination}
              isChecked={!!checkedRows[destination.name]}
              onCheckChange={(isChecked) => handleCheckChange(destination.name, isChecked)}
              parentCopilotPointer={copilotPointer}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_ ](.)/g, (match, group1) => {
      return group1.toUpperCase();
    })
    .replace(/^(.)/, (match, group1) => group1.toLowerCase());
}
