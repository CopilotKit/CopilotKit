import {
  useCopilotAction,
  useCopilotReadable,
} from "@copilotkit/react-core";
import React, { useContext, useState } from "react";
import Spreadsheet from "react-spreadsheet";
import { canonicalSpreadsheetData } from "../utils/canonicalSpreadsheetData";
import { SpreadsheetData, SpreadsheetRow } from "../types";
import { PreviewSpreadsheetChanges } from "./PreviewSpreadsheetChanges";
import { ThemeContext } from "./ThemeProvider";

interface MainAreaProps {
  spreadsheet: SpreadsheetData;
  setSpreadsheet: (spreadsheet: SpreadsheetData) => void;
  spreadSheets: SpreadsheetData[];
  selectedSpreadsheetIndex: number;
  setSelectedSpreadsheetIndex: (index: number) => void;
}

const SingleSpreadsheet = ({ spreadsheet, setSpreadsheet, spreadSheets, selectedSpreadsheetIndex, setSelectedSpreadsheetIndex }: MainAreaProps) => {
  const { theme, toggleTheme } = useContext(ThemeContext);

  useCopilotReadable({
    description: "The current spreadsheet",
    value: spreadsheet,
  })

  useCopilotAction({
    name: "suggestSpreadsheetOverride",
    description: "Suggest an override of the current spreadsheet",
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
        required: false,
        nullable: true,
      },
    ],
    render: (props) => {
      const { rows } = props.args
      const newRows = canonicalSpreadsheetData(rows);

      return (
        <PreviewSpreadsheetChanges
          preCommitTitle="Replace contents"
          postCommitTitle="Changes committed"
          newRows={newRows}
          commit={(rows) => {
            const updatedSpreadsheet: SpreadsheetData = {
              title: spreadsheet.title,
              rows: rows,
            };
            setSpreadsheet(updatedSpreadsheet);
          }}
        />
      )
    },
    handler: ({ rows, title }) => {
      // Do nothing.
      // The preview component will optionally handle committing the changes.
    },
  });

  useCopilotAction({
    name: "appendToSpreadsheet",
    description: "Append rows to the current spreadsheet",
    parameters: [
      {
        name: "rows",
        type: "object[]",
        description: "The new rows of the spreadsheet",
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
    ],
    render: (props) => {
      const status = props.status;
      const { rows } = props.args
      const newRows = canonicalSpreadsheetData(rows);
      return (
        <div>
          <p>Status: {status}</p>
          <Spreadsheet
            data={newRows}
          />
        </div>
      )
    },
    handler: ({ rows }) => {
      const canonicalRows = canonicalSpreadsheetData(rows);
      const updatedSpreadsheet: SpreadsheetData = {
        title: spreadsheet.title,
        rows: [...spreadsheet.rows, ...canonicalRows],
      };
      setSpreadsheet(updatedSpreadsheet);
    },
  });

  return (
    <>
      <div className="flex-1 overflow-auto p-5">
        <input
          type="text"
          value={spreadsheet.title}
          className="w-full p-2 mb-5 text-center text-2xl font-bold outline-none bg-transparent"
          onChange={(e) =>
            setSpreadsheet({ ...spreadsheet, title: e.target.value })
          }
        />
        <div className="flex items-start">
          <Spreadsheet
            data={spreadsheet.rows}
            onChange={(data) => {
              console.log("data", data);
              setSpreadsheet({ ...spreadsheet, rows: data as any });
            }}
          />
          <button
            className="bg-blue-500 text-white rounded-lg w-8 h-8 ml-5 "
            onClick={() => {
              // add an empty cell to each row
              const spreadsheetRows = [...spreadsheet.rows];
              for (let i = 0; i < spreadsheet.rows.length; i++) {
                spreadsheet.rows[i].push({ value: "" });
              }
              setSpreadsheet({
                ...spreadsheet,
                rows: spreadsheetRows,
              });
            }}
          >
            +
          </button>
        </div>
        <button
          style={{ marginBottom: 200 }}
          className="bg-blue-500 text-white rounded-lg w-8 h-8 mt-5 "
          onClick={() => {
            const numberOfColumns = spreadsheet.rows[0].length;
            const newRow: SpreadsheetRow = [];
            for (let i = 0; i < numberOfColumns; i++) {
              newRow.push({ value: "" });
            }
            setSpreadsheet({
              ...spreadsheet,
              rows: [...spreadsheet.rows, newRow],
            });
          }}
        >
          +
        </button>
      </div>
      <div >
        <div className="fixed bottom-0 left-0 right-0 bg-gray-100 text-white flex items-center justify-between p-2 shadow-lg">
          <div className="flex space-x-2">
            {/* Replace with dynamic sheet buttons */}
            {spreadSheets.map((sheet, index) => (
              <button
                key={index}
                className={`${selectedSpreadsheetIndex == index ? "bg-blue-100 text-blue-600 font-bold" : "bg-gray-100 text-black"} px-4 py-2 rounded hover:bg-gray-300 transition`}
                onClick={() => {
                  setSelectedSpreadsheetIndex(index);
                }}
              >
                {sheet.title}
              </button>
            ))}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full bg-gray-500 hover:bg-gray-700"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>

        </div>
      </div>
    </>
  );
};

export default SingleSpreadsheet;


