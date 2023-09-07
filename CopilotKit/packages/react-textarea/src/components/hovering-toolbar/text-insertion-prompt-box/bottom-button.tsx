import React from "react";

interface BottomButtonProps {
  loading: boolean;
  editSuggestion: string | null;
  generateText: () => void;
  performInsertion: (insertedText: string) => void;
}
export const BottomButton: React.FC<BottomButtonProps> = ({
  loading,
  editSuggestion,
  generateText,
  performInsertion,
}): JSX.Element | null => {
  if (loading) {
    return (
      <button
        disabled
        className="w-full py-2 px-4 rounded-md text-white bg-gray-400"
      >
        Loading...
      </button>
    );
  }

  if (editSuggestion !== null) {
    return null;
    // return (
    //   <button
    //     onClick={() => {
    //       performInsertion(editSuggestion);
    //     }}
    //     className="w-full mt-2 py-2 px-4 rounded-md text-white bg-green-700 hover:bg-green-800"
    //   >
    //     Insert Text
    //   </button>
    // );
  }

  return (
    <button
      onClick={generateText}
      className="w-full py-2 px-4 rounded-md text-white bg-blue-500 hover:bg-blue-700"
    >
      Generate Text
    </button>
  );
};
