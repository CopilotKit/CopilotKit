"use client";
import { DEFAULT_CAMPAIGNS } from "@/lib/data";
import { Campaign } from "@/lib/types";
import { use, useState } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";

import _ from "lodash";
import { Dashboard } from "../dashboard/Dashboard";
import { CampaignForm } from "./CampaignForm";
import { randomId } from "@/lib/utils";
import { GUIDELINE } from "@/lib/guideline";
import { SCRIPT_SUGGESTION } from "@/lib/script";

export function App() {
  const [segments, setSegments] = useState<string[]>([
    "Millennials/Female/Urban",
    "Parents/30s/Suburbs",
    "Seniors/Female/Rural",
    "Professionals/40s/Midwest",
    "Gamers/Male",
  ]);

  const [campaigns, setCampaigns] = useState<Campaign[]>(
    _.cloneDeep(DEFAULT_CAMPAIGNS)
  );

  function saveCampaign(campaign: Campaign) {
    if (campaign.id === "") {
      campaign.id = randomId();
      setCampaigns([campaign, ...campaigns]);
    } else {
      const index = campaigns.findIndex((c) => c.id === campaign.id);
      if (index === -1) {
        setCampaigns([...campaigns, campaign]);
      } else {
        campaigns[index] = campaign;
        setCampaigns([...campaigns]);
      }
    }
  }

  const [currentCampaign, setCurrentCampaign] = useState<Campaign | undefined>(
    undefined
  );

  // Ground the Copilot with domain-specific knowledge for this use-case: marketing campaigns.
  useCopilotReadable({ description: "Guideline", value: GUIDELINE });
  useCopilotReadable({ description: "Script", value: SCRIPT_SUGGESTION });

  // Provide the Copilot with the current date.
  useCopilotReadable({
    description: "Current Date",
    value: new Date().toDateString(),
  });

  // Provide this component's Copilot with the ability to update the current campaign.
  //
  // This implementation uses a single large function with optional parameters to update the current campaign.
  // But you can also use multiple smaller actions to update different parts of the campaign - even one for each field.
  // Up to you.
  //
  // (In the near future we will provide CopilotForm types, which unify useCopilotReadable and useCopilotAction for a given form's values.
  // Feel free to ask about this on our Discord: https://discord.gg/t89H6TzmKm).
  useCopilotAction({
    name: "updateCurrentCampaign",
    description:
      "Edit an existing campaign or create a new one. To update only a part of a campaign, provide the id of the campaign to edit and the new values only.",
    parameters: [
      {
        name: "id",
        description:
          "The id of the campaign to edit. If empty, a new campaign will be created",
        type: "string",
      },
      {
        name: "title",
        description: "The title of the campaign",
        type: "string",
        required: false,
      },
      {
        name: "keywords",
        description: "Search keywords for the campaign",
        type: "string",
        required: false,
      },
      {
        name: "url",
        description:
          "The URL to link the ad to. Most of the time, the user will provide this value, leave it empty unless asked by the user.",
        type: "string",
        required: false,
      },
      {
        name: "headline",
        description:
          "The headline displayed in the ad. This should be a 5-10 words",
        type: "string",
        required: false,
      },
      {
        name: "description",
        description:
          "The description displayed in the ad. This should be a short text",
        type: "string",
        required: false,
      },

      {
        name: "budget",
        description: "The budget of the campaign",
        type: "number",
        required: false,
      },
      {
        name: "objective",
        description: "The objective of the campaign",
        type: "string",
        enum: [
          "brand-awareness",
          "lead-generation",
          "sales-conversion",
          "website-traffic",
          "engagement",
        ],
      },

      {
        name: "bidStrategy",
        description: "The bid strategy of the campaign",
        type: "string",
        enum: ["manual-cpc", "cpa", "cpm"],
        required: false,
      },
      {
        name: "bidAmount",
        description: "The bid amount of the campaign",
        type: "number",
        required: false,
      },
      {
        name: "segment",
        description: "The segment of the campaign",
        type: "string",
        required: false,
        enum: segments,
      },
    ],
    handler: (campaign) => {
      const newValue = _.assign(
        _.cloneDeep(currentCampaign),
        _.omitBy(campaign, _.isUndefined)
      ) as Campaign;

      setCurrentCampaign(newValue);
    },
    render: (props) => {
      if (props.status === "complete") {
        return "Campaign updated successfully";
      } else {
        return "Updating campaign";
      }
    },
  });

  // Provide this component's Copilot with the ability to retrieve historical cost data for certain keywords.
  // Will be called automatically when needed by the Copilot.
  useCopilotAction({
    name: "retrieveHistoricalData",
    description: "Retrieve historical data for certain keywords",
    parameters: [
      {
        name: "keywords",
        description: "The keywords to retrieve data for",
        type: "string",
      },
      {
        name: "type",
        description: "The type of data to retrieve for the keywords.",
        type: "string",
        enum: ["CPM", "CPA", "CPC"],
      },
    ],
    handler: async ({ type }) => {
      // fake an API call that retrieves historical data for cost for certain keywords based on campaign type (CPM, CPA, CPC)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      function getRandomValue(min: number, max: number) {
        return (Math.random() * (max - min) + min).toFixed(2);
      }

      if (type == "CPM") {
        return getRandomValue(0.5, 10);
      } else if (type == "CPA") {
        return getRandomValue(5, 100);
      } else if (type == "CPC") {
        return getRandomValue(0.2, 2);
      }
    },
    render: (props) => {
      // Custom in-chat component rendering. Different components can be rendered based on the status of the action.
      let label = "Retrieving historical data ...";
      if (props.args.type) {
        label = `Retrieving ${props.args.type} for keywords ...`;
      }
      if (props.status === "complete") {
        label = `Done retrieving ${props.args.type} for keywords.`;
      }

      const done = props.status === "complete";
      return (
        <div className="">
          <div className=" w-full relative max-w-xs">
            <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-blue-500 to-teal-500 transform scale-[0.80] bg-red-500 rounded-full blur-3xl" />
            <div className="relative shadow-xl bg-gray-900 border border-gray-800  px-4 py-8 h-full overflow-hidden rounded-2xl flex flex-col justify-end items-start">
              <h1 className="font-bold text-sm text-white mb-4 relative z-50">
                {label}
              </h1>
              <p className="font-normal text-base text-teal-200 mb-2 relative z-50 whitespace-pre">
                {props.args.type &&
                  `Historical ${props.args.type}: ${props.result || "..."}`}
              </p>
            </div>
          </div>
        </div>
      );
    },
  });

  return (
    <div className="relative">
      <CampaignForm
        segments={segments}
        currentCampaign={currentCampaign}
        setCurrentCampaign={setCurrentCampaign}
        saveCampaign={(campaign) => {
          if (campaign) {
            saveCampaign(campaign);
          }
          setCurrentCampaign(undefined);
        }}
      />
      <Dashboard
        campaigns={campaigns}
        setCurrentCampaign={setCurrentCampaign}
        segments={segments}
        setSegments={setSegments}
      />
    </div>
  );
}
