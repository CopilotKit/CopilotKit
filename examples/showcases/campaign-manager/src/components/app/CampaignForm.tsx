import React, { useEffect, useState } from "react";
import { Campaign } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import clsx from "clsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCopilotReadable } from "@copilotkit/react-core";

interface CampaignFormProps {
  currentCampaign?: Campaign;
  setCurrentCampaign: (campaign?: Campaign) => void;
  segments: string[];
  saveCampaign: (campaign?: Campaign) => void;
}

export function CampaignForm({
  currentCampaign,
  setCurrentCampaign,
  saveCampaign,
  segments,
}: CampaignFormProps) {
  useCopilotReadable({
    description: "Current Campaign",
    value: currentCampaign,
  });

  if (!currentCampaign) return null;
  return (
    <div
      className="bg-white/70 absolute inset-0 z-10"
      style={{
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div className="bg-white p-5 rounded-lg shadow-lg max-w-2xl w-full mx-auto my-16 space-y-4 border">
        <h2 className="text-xl font-semibold text-gray-900 border-b pb-3">
          {currentCampaign.id == "" ? "New" : "Edit"} Campaign
        </h2>
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <div className="p-4 border border-gray-200 rounded-sm mr-1">
            <h3 className="text-lg font-semibold mb-4">Campaign Information</h3>
            <div className="flex">
              <TextInput
                id="title"
                label="Campaign Name"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
                className="w-1/2"
              />
              <Dropdown
                id="objective"
                label="Campaign Objective"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
                className="w-1/2"
                items={{
                  "brand-awareness": "Brand Awareness",
                  "lead-generation": "Lead Generation",
                  "sales-conversion": "Sales Conversion",
                  "website-traffic": "Website Traffic",
                  engagement: "Engagement",
                }}
              />
            </div>
            <div className="flex">
              <Dropdown
                id="segment"
                label="Segment"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
                className="w-1/2"
                items={Object.fromEntries(segments.map((s) => [s, s]))}
              />
            </div>
          </div>
          <div className="p-4 border border-gray-200 rounded-sm mt-3 mr-1">
            <h3 className="text-lg font-semibold mb-4">Budget & Bidding</h3>
            <div className="flex">
              <TextInput
                id="budget"
                label="Total Budget"
                className="w-1/2"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
            </div>
            <div className="flex">
              <Dropdown
                id="bidStrategy"
                label="Bid Strategy"
                className="w-1/2"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
                items={{
                  "manual-cpc": "Manual CPC",
                  cpa: "CPA",
                  cpm: "CPM",
                }}
              />
              <TextInput
                id="bidAmount"
                label="Bid Amount"
                className="w-1/2"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
            </div>
          </div>
          <div className="p-4 border border-gray-200 rounded-sm mt-3 mr-1">
            <h3 className="text-lg font-semibold mb-4">Ad Copy</h3>
            <div className="flex">
              <TextInput
                className="w-1/2"
                id="keywords"
                label="Keywords"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
              <TextInput
                className="w-1/2"
                id="finalUrl"
                label="Final URL"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
            </div>
            <div className="flex">
              <TextInput
                className="w-1/2"
                id="headline"
                label="Headline"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
              <TextInput
                className="w-1/2"
                id="description"
                label="Description"
                campaign={currentCampaign}
                setCampaign={setCurrentCampaign}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            className="mr-5"
            onClick={() => saveCampaign(undefined)}
          >
            Cancel
          </Button>
          <Button onClick={() => saveCampaign(currentCampaign)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

interface TextInputProps {
  id: string;
  label: string;
  className?: string;
  campaign: Campaign;
  setCampaign: (campaign: Campaign) => void;
}

function TextInput({
  id,
  label,
  className,
  campaign,
  setCampaign,
}: TextInputProps) {
  return (
    <div className={clsx("grid w-full items-center gap-1.5 p-2", className)}>
      <Label className="text-xs " htmlFor={id}>
        {label}
      </Label>
      <Input
        type="text"
        className="text-xs px-2 ring-0 outline-0 focus-visible:ring-0"
        id={id}
        placeholder={label}
        onChange={(e: any) =>
          setCampaign({
            ...campaign,
            [id]: e.target.value,
          })
        }
        value={(campaign as any)[id] || ""}
      />
    </div>
  );
}

interface DropdownProps {
  id: string;
  label: string;
  className?: string;
  campaign: Campaign;
  setCampaign: (campaign: Campaign) => void;
  items: { [key: string]: string };
}

function Dropdown({
  id,
  label,
  className,
  campaign,
  setCampaign,
  items,
}: DropdownProps) {
  return (
    <div className={clsx("grid w-full items-center gap-1.5 p-2", className)}>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Select
        onValueChange={(value) => setCampaign({ ...campaign, [id]: value })}
        value={(campaign as any)[id] || ""}
      >
        <SelectTrigger className="w-full text-xs focus:ring-0">
          <SelectValue className="text-xs" placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([key, value]) => (
            <SelectItem key={key} value={key} className="text-xs">
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
