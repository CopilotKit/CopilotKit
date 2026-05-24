"use client";
import "@copilotkit/react-ui/styles.css";

import React, { useState } from "react";
import SingleSpreadsheet from "./components/SingleSpreadsheet";
import {
  CopilotKit,
  useCopilotAction,
  useCopilotReadable,
} from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useCopilotChatSuggestions,
} from "@copilotkit/react-ui";
import { INSTRUCTIONS } from "./instructions";
import { canonicalSpreadsheetData } from "./utils/canonicalSpreadsheetData";
import { SpreadsheetData } from "./types";
import { PreviewSpreadsheetChanges } from "./components/PreviewSpreadsheetChanges";
import { sampleData, sampleData2 } from "./utils/sampleData";
// import { Bottombar } from "./components/Bottombar";

type WorkPaperPricingProof = {
  input: {
    units: number;
    unitPrice: number;
    discountRate: number;
  };
  editedCells: string[];
  formulaCells: string[];
  readback: {
    grossRevenue: string;
    discountAmount: string;
    netRevenue: string;
  };
  expectedNetRevenue: number;
  persistedDocumentBytes: number;
  verified: boolean;
};

const HomePage = () => {
  return (
    <CopilotKit
      runtimeUrl="api/copilotkit"
      transcribeAudioUrl="/api/transcribe"
      textToSpeechUrl="/api/tts"
    >
      <CopilotSidebar
        instructions={INSTRUCTIONS}
        labels={{
          initial:
            "Welcome to the spreadsheet app!  What would you like help with?",
        }}
        defaultOpen={true}
        clickOutsideToClose={false}
      >
        <Main />
      </CopilotSidebar>
    </CopilotKit>
  );
};

// function rowsGenerator(n : number) {
//   const rows = [];

//   for (let i = 0; i < 25; i++) {
//     const row = [];

//     for (let j = 0; j < 25; j++) {
//       if (i < n && j < n) {
//         row.push({ value: "Sample data" });
//       }
//       else {
//         row.push({ value: "" });
//       }

//     }
//     rows.push(row);

//   }
//   return rows;

// }

const Main = () => {
  const [spreadsheets, setSpreadsheets] = React.useState<SpreadsheetData[]>([
    {
      title: "Revenue by department",
      rows: sampleData,
    },
    {
      title: "Projects Tracker",
      rows: sampleData2,
    },
  ]);

  const [selectedSpreadsheetIndex, setSelectedSpreadsheetIndex] = useState(0);
  const [workpaperPricingProof, setWorkpaperPricingProof] =
    useState<WorkPaperPricingProof | null>(null);

  useCopilotAction({
    name: "createSpreadsheet",
    description: "Create a new spreadsheet",
    parameters: [
      {
        name: "rows",
        type: "object[]",
        description: "The rows of the spreadsheet",
        attributes: [
          {
            name: "cells",
            type: "object[]",
            description: "The cells of the row",
            attributes: [
              {
                name: "value",
                type: "string",
                description: "The value of the cell",
              },
            ],
          },
        ],
      },
      {
        name: "title",
        type: "string",
        description: "The title of the spreadsheet",
      },
    ],
    render: (props) => {
      console.log("createSpreadsheet => props: => ", props);
      const { rows, title } = props.args;
      const newRows = canonicalSpreadsheetData(rows);

      return (
        <PreviewSpreadsheetChanges
          preCommitTitle="Create spreadsheet"
          postCommitTitle="Spreadsheet created"
          newRows={newRows}
          commit={(rows) => {
            const newSpreadsheet: SpreadsheetData = {
              title: title || "Untitled Spreadsheet",
              rows: rows,
            };
            setSpreadsheets((prev) => [...prev, newSpreadsheet]);
            setSelectedSpreadsheetIndex(spreadsheets.length);
          }}
        />
      );
    },
    handler: ({ rows, title }) => {
      // Do nothing.
      // The preview component will optionally handle committing the changes.
    },
  });

  useCopilotChatSuggestions({
    instructions:
      "Provide suggestions for the user like creating a new sheet with sample data, appending rows, telling them about this view. Strictly show only these options at the start of the chat.",
    maxSuggestions: 3,
    minSuggestions: 1,
  });
  useCopilotReadable({
    description: "Today's date",
    value: new Date().toLocaleDateString(),
  });

  useCopilotAction({
    name: "runPricingWorkbook",
    description:
      "Run a backend Bilig WorkPaper pricing model, then return formula readback proof.",
    parameters: [
      {
        name: "units",
        type: "number",
        description: "Number of units sold.",
      },
      {
        name: "unitPrice",
        type: "number",
        description: "Price per unit without currency symbols or commas.",
      },
      {
        name: "discountRate",
        type: "number",
        description: "Discount as a decimal, for example 0.2 for 20%.",
      },
    ],
    handler: async ({ units, unitPrice, discountRate }) => {
      const response = await fetch("/api/workpaper-pricing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ units, unitPrice, discountRate }),
      });

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "WorkPaper pricing run failed");
      }

      const proof = (await response.json()) as WorkPaperPricingProof;
      setWorkpaperPricingProof(proof);
      return proof;
    },
  });

  return (
    <div className="flex">
      <SingleSpreadsheet
        spreadSheets={spreadsheets}
        selectedSpreadsheetIndex={selectedSpreadsheetIndex}
        setSelectedSpreadsheetIndex={setSelectedSpreadsheetIndex}
        spreadsheet={spreadsheets[selectedSpreadsheetIndex]}
        setSpreadsheet={(spreadsheet) => {
          setSpreadsheets((prev) => {
            console.log("setSpreadsheet", spreadsheet);
            const newSpreadsheets = [...prev];
            newSpreadsheets[selectedSpreadsheetIndex] = spreadsheet;
            return newSpreadsheets;
          });
        }}
      />
      {workpaperPricingProof && (
        <aside className="fixed right-6 bottom-20 max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-lg">
          <h2 className="mb-2 font-semibold text-slate-950">
            WorkPaper formula proof
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Gross</dt>
            <dd>{workpaperPricingProof.readback.grossRevenue}</dd>
            <dt>Discount</dt>
            <dd>{workpaperPricingProof.readback.discountAmount}</dd>
            <dt>Net</dt>
            <dd>{workpaperPricingProof.readback.netRevenue}</dd>
            <dt>Verified</dt>
            <dd>{workpaperPricingProof.verified ? "true" : "false"}</dd>
          </dl>
        </aside>
      )}
    </div>
  );
};

export default HomePage;
