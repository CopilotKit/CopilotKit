import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Campaign } from "@/lib/types";

interface ActiveCampaignsProps {
  campaigns: Campaign[];
  setCurrentCampaign: (campaign: Campaign) => void;
}

export function ActiveCampaigns({
  campaigns,
  setCurrentCampaign,
}: ActiveCampaignsProps) {
  return (
    <div className="space-y-4">
      {campaigns.map((campaign) => (
        <ActiveCampaign
          key={campaign.id}
          campaign={campaign}
          onClick={(campaign) => setCurrentCampaign(campaign)}
        />
      ))}
    </div>
  );
}

interface ActiveCampaignProps {
  campaign: Campaign;
  onClick: (campaign: Campaign) => void;
}

function ActiveCampaign({ campaign, onClick }: ActiveCampaignProps) {
  const titleInitials = (campaign.title || "")
    .split(" ")
    .map((word) => (word.length > 0 ? word[0] : ""))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const budget = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(campaign.budget));

  return (
    <div
      className="flex items-center hover:ring-1 ring-gray-400 rounded-md cursor-pointer p-3 hover:bg-gray-50 group"
      onClick={() => {
        onClick(campaign);
      }}
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback className="group-hover:border">
          {titleInitials}
        </AvatarFallback>
      </Avatar>
      <div className="ml-4 space-y-1">
        <p className="text-sm font-medium leading-none">{campaign.title}</p>
        <p
          className="text-sm text-muted-foreground truncate"
          style={{ maxWidth: "250px" }}
        >
          {budget}
        </p>
      </div>
    </div>
  );
}
