import { TrashIcon, XCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import React, { useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface SegmentsManagerProps {
  segments: string[];
  setSegments: (segments: string[]) => void;
  onClose: () => void;
}

const SegmentsManager = ({
  segments,
  setSegments,
  onClose,
}: SegmentsManagerProps) => {
  const [newSegment, setNewSegment] = useState("");

  const addSegment = () => {
    if (newSegment) {
      setSegments([...segments, newSegment]);
      setNewSegment(""); // Reset the input
    }
  };

  const removeSegment = (index: number) => {
    setSegments(segments.filter((_, i) => i !== index));
  };

  return (
    <div
      className="bg-white/70 absolute inset-0 z-10"
      style={{
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div className="bg-white p-5 rounded-lg shadow-lg max-w-2xl w-full mx-auto my-16 space-y-4 border relative">
        <div className="flex border-b items-center justify-center">
          <h2 className="text-xl font-semibold text-gray-900 pb-3 flex-1 items-center">
            Edit Customer Segments
          </h2>
          <button className="flex" onClick={() => onClose()}>
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>
        <div>
          <div className="flex">
            <Input
              type="text"
              className="mr-4"
              value={newSegment}
              onChange={(e) => setNewSegment(e.target.value)}
              placeholder="Enter a new segment"
            />
            <Button onClick={addSegment}>Add Segment</Button>
          </div>

          <ul>
            {segments.map((segment, index) => (
              <li key={index} className="p-2 flex items-center group">
                {segment}{" "}
                <button onClick={() => removeSegment(index)}>
                  <TrashIcon className="h-5 w-5 hidden group-hover:block text-red-700 ml-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SegmentsManager;
