import { useMakeCopilotActionable } from "@copilotkit/react-core";
import React, { useState } from "react";
import PersonList, { peopleListA, peopleListB } from "./person-list";

export function GoodPeopleBadPeople(): JSX.Element {
  const [searchFieldText, setSearchFieldText] = useState("");

  useMakeCopilotActionable(
    {
      name: "setSearchFieldText",
      description: "Set the search field text to the given value",
      argumentAnnotations: [
        {
          name: "searchTerm",
          type: "string",
          description: "The text we wish to search for",
          required: true,
        },
      ],
      implementation: async (searchTerm: string) => {
        setSearchFieldText(searchTerm);
      },
    },
    []
  );

  return (
    <div className="w-full mx-auto px-6 pt-4 pb-10">
      <h2 className="font-bold text-2xl">Search</h2>
      <input
        type="text"
        value={searchFieldText}
        onChange={(e) => setSearchFieldText(e.target.value)}
        className="bg-slate-100 rounded-lg py-4 px-4 my-2 w-full"
        placeholder="Search..."
      />

      <div className=" bg-slate-100 rounded-lg py-8 px-8 mt-10 w-full">
        <PersonList title="Current employees" people={peopleListA} />
      </div>

      <div className=" bg-slate-100 rounded-lg py-8 px-8 mt-20 w-full">
        <PersonList title="Ex employees" people={peopleListB} />
      </div>
    </div>
  );
}
