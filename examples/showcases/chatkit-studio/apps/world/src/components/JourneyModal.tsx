"use client";

import { useState } from "react";
import type { VisitedCountry, LevelInfo } from "@/hooks/useJourneyProgress";
import ResetConfirmDialog from "./ResetConfirmDialog";

interface JourneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitedCountries: VisitedCountry[];
  totalCountries: number;
  currentLevel: LevelInfo;
  countriesToNextLevel: number;
  onReset: () => void;
}

export default function JourneyModal({
  isOpen,
  onClose,
  visitedCountries,
  totalCountries,
  currentLevel,
  countriesToNextLevel,
  onReset,
}: JourneyModalProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  if (!isOpen) return null;

  const handleReset = () => {
    onReset();
    setShowResetDialog(false);
    setShowMenu(false);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">
              Your Journey{" "}
              <span className="text-gray-400 font-normal text-xl">
                {visitedCountries.length}/{totalCountries}
              </span>
            </h2>

            <div className="flex items-center gap-2">
              {/* Menu Button */}
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg
                    className="w-6 h-6 text-gray-600"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="6" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="18" r="2" />
                  </svg>
                </button>

                {/* Menu Dropdown */}
                {showMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-10">
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        setShowResetDialog(true);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Reset Progress
                    </button>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg
                  className="w-6 h-6 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Current Level Section */}
            <div className="bg-gray-50 rounded-2xl p-5 mb-6">
              <h3 className="text-sm font-medium text-gray-600 mb-3">Current Level</h3>
              <div className="flex items-center gap-4">
                <div className={`${currentLevel.color} text-white w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold`}>
                  {currentLevel.level}
                </div>
                <div>
                  <h4 className="text-xl font-bold text-gray-900">{currentLevel.name}</h4>
                  <p className="text-sm text-gray-500">
                    {countriesToNextLevel > 0
                      ? `${countriesToNextLevel} to next level`
                      : "Max level reached!"}
                  </p>
                </div>
              </div>
            </div>

            {/* Visited Countries */}
            {visitedCountries.length > 0 ? (
              <div>
                <h3 className="text-sm font-medium text-gray-600 mb-3">
                  Visited Countries ({visitedCountries.length})
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {visitedCountries.map((country) => (
                    <div
                      key={country.name}
                      className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4 hover:bg-gray-100 transition-colors"
                    >
                      {country.flagEmoji && (
                        <span className="text-3xl">{country.flagEmoji}</span>
                      )}
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {country.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg mb-2">No countries visited yet</p>
                <p className="text-gray-400 text-sm">
                  Click on a country to start your journey!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <ResetConfirmDialog
        isOpen={showResetDialog}
        onCancel={() => setShowResetDialog(false)}
        onConfirm={handleReset}
      />
    </>
  );
}
