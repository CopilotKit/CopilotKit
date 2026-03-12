import { Button } from "@/components/ui/button";
import { ChevronDown, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardBrand, MemberRole } from "@/app/api/v1/data";
import { PERMISSIONS } from "@/app/api/v1/permissions";

interface AddCardDropdownProps {
  currentUser: {
    role: MemberRole;
  };
  handleAddCard: (params: { type: CardBrand }) => void;
}

export function AddCardDropdown({
  currentUser,
  handleAddCard,
}: AddCardDropdownProps) {
  const hasPermission = PERMISSIONS.ADD_CARD.includes(currentUser.role);

  const dropdownButton = (
    <Button disabled={!hasPermission}>
      <Plus className="mr-2 h-4 w-4" /> Add New Card{" "}
      <ChevronDown className="ml-2 h-4 w-4" />
    </Button>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            {hasPermission ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {dropdownButton}
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => handleAddCard({ type: CardBrand.Visa })}
                  >
                    <div className="flex items-center">
                      <svg className="h-5 w-8 mr-2" viewBox="0 0 780 500" xmlns="http://www.w3.org/2000/svg">
                        <path d="M293.2 348.7l33.4-195.8h53.4l-33.4 195.8zM540.7 157.2c-10.6-4-27.2-8.3-47.9-8.3-52.8 0-90 26.6-90.2 64.6-.3 28.1 26.5 43.8 46.8 53.2 20.8 9.6 27.8 15.7 27.7 24.3-.1 13.1-16.6 19.1-32 19.1-21.4 0-32.7-3-50.3-10.2l-6.9-3.1-7.5 43.8c12.5 5.5 35.6 10.2 59.6 10.5 56.2 0 92.6-26.3 93-66.8.2-22.3-14-39.2-44.8-53.2-18.6-9.1-30.1-15.1-30-24.3 0-8.1 9.7-16.8 30.6-16.8 17.4-.3 30.1 3.5 39.9 7.5l4.8 2.3 7.2-42.7zM676.3 152.9h-41.3c-12.8 0-22.4 3.5-28 16.3l-79.4 179.5h56.2s9.2-24.2 11.3-29.5c6.1 0 60.8.1 68.6.1 1.6 6.9 6.5 29.4 6.5 29.4h49.7l-43.6-195.8zm-65.8 126.3c4.4-11.3 21.4-54.8 21.4-54.8-.3.5 4.4-11.4 7.1-18.8l3.6 17s10.3 47 12.4 56.6h-44.5zM232.2 152.9L180 283.6l-5.6-27c-9.7-31.2-39.9-65-73.7-81.9l47.9 173.8h56.6l84.2-195.6h-57.2" fill="#1a1f71"/>
                        <path d="M131.9 152.9H46.3l-.7 3.8c67.1 16.2 111.5 55.4 129.9 102.5L157.2 169c-3.2-12.5-12.7-15.7-25.3-16.1" fill="#f7a600"/>
                      </svg>
                      Add Visa Card
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleAddCard({ type: CardBrand.MasterCard })
                    }
                  >
                    <div className="flex items-center">
                      <svg className="h-5 w-8 mr-2" viewBox="0 0 780 500" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="312" cy="250" r="200" fill="#eb001b"/>
                        <circle cx="468" cy="250" r="200" fill="#f79e1b"/>
                        <path d="M390 100.2c-49.7 38.3-81.6 98.1-81.6 165.8s31.9 127.5 81.6 165.8c49.7-38.3 81.6-98.1 81.6-165.8S439.7 138.5 390 100.2z" fill="#ff5f00"/>
                      </svg>
                      Add Mastercard
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              dropdownButton
            )}
          </div>
        </TooltipTrigger>
        {!hasPermission && (
          <TooltipContent>
            <p>Only admins can add new cards</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
