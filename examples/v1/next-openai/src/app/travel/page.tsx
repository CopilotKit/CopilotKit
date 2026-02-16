"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "./styles.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

interface BookableItem {
  name: string;
  arrivalDate: string;
  departureDate: string;
}

export default function PanelPage() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") ||
    `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: publicApiKey || undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <TravelPlanner />
    </CopilotKit>
  );
}

function TravelPlanner() {
  const [bookableItems, setBookableItems] = useState<BookableItem[]>([]);

  useCopilotAction({
    name: "presentHotelOrLocation",
    description:
      "Call this function to present the user with a hotel or location or really anything related to travel.",
    parameters: [
      {
        name: "title",
        type: "string",
        description: "The title of the hotel or location.",
      },
      {
        name: "description",
        type: "string",
      },
      {
        name: "image",
        type: "string",
        description: "The url of an image if available.",
        required: false,
      },
    ],
    handler: async ({ title }) => {
      return `Presented ${title}`;
    },
    render({ status, args }) {
      return (
        <div className="w-96 rounded-lg border bg-white shadow-sm">
          <div className="px-4 py-4">
            <h1 className="text-xl font-bold">{args.title || ""}</h1>
            <p className="text-sm">{args.description || ""}</p>
          </div>
          {status == "complete" && (
            <Image
              className="rounded-b-lg"
              src={args.image || ""}
              alt={args.title || ""}
            />
          )}
        </div>
      );
    },
  });

  useCopilotAction({
    name: "bookHotel",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The title of the hotel.",
      },
      {
        name: "arrivalDate",
        type: "string",
        description: "The date of arrival (ask).",
      },
      {
        name: "departureDate",
        type: "string",
        description: "The date of departure (ask).",
      },
    ],
    handler: async ({ name, arrivalDate, departureDate }) => {
      setBookableItems((prev) => [
        ...prev,
        { name, arrivalDate, departureDate },
      ]);
    },
  });

  return (
    <div className="flex h-full">
      <CopilotChat
        className="h-full w-2/3 border-r border-gray-200"
        labels={{
          initial: "Hi you! 👋 Let's book your next vacation. Ask me anything.",
        }}
        instructions="You are a travel planner. You help the user plan their vacation. After presenting something, don't summarize, but keep the reply short."
      />
      <div className="flex h-full flex-1 flex-col space-y-4 p-4">
        {bookableItems.length === 0 ? (
          <p className="flex h-full w-full items-center justify-center p-3 pt-8 text-sm text-black">
            No items booked yet. Your cart is empty.
          </p>
        ) : (
          <>
            <h2 className="mb-4 text-2xl font-bold">Your Bookings</h2>
            {bookableItems.map((item, index) => (
              <div
                key={index}
                className="relative rounded-lg border bg-white p-4 shadow-md"
              >
                <button
                  className="absolute right-2 top-2 text-xs text-red-500"
                  onClick={() =>
                    setBookableItems((prev) =>
                      prev.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
                <h2 className="text-lg font-semibold">{item.name}</h2>
                <p className="text-sm text-gray-600">
                  Arrival: {item.arrivalDate}
                </p>
                <p className="text-sm text-gray-600">
                  Departure: {item.departureDate}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
