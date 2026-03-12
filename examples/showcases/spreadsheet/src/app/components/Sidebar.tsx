import React, { useContext } from "react";
import { SpreadsheetData } from "../types";
import { ThemeContext } from "./ThemeProvider";

interface SidebarProps {
  spreadsheets: SpreadsheetData[];
  selectedSpreadsheetIndex: number;
  setSelectedSpreadsheetIndex: (index: number) => void;
}

const Sidebar = ({
  spreadsheets,
  selectedSpreadsheetIndex,
  setSelectedSpreadsheetIndex,
}: SidebarProps) => {
  const { theme, toggleTheme } = useContext(ThemeContext);

  return (
    <div className="w-64 h-screen bg-gray-800 text-white overflow-auto p-5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Spreadsheets</h2>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full hover:bg-gray-700"
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
      <ul>
        {spreadsheets.map((spreadsheet, index) => (
          <li
            key={index}
            className={`mb-4 cursor-pointer ${index === selectedSpreadsheetIndex
              ? "ring-2 ring-blue-500 ring-inset p-3 rounded-lg"
              : "p-3"
              }`}
            onClick={() => setSelectedSpreadsheetIndex(index)}
          >
            {spreadsheet.title}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;
