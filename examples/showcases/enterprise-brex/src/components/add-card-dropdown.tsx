import { Button } from "@/components/ui/button";
import { ChevronDown, CreditCard, Plus } from "lucide-react";
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
                      <div className="bg-blue-500 rounded-full p-1 mr-2">
                        <CreditCard className="h-4 w-4 text-white" />
                      </div>
                      Add Visa Card
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleAddCard({ type: CardBrand.MasterCard })
                    }
                  >
                    <div className="flex items-center">
                      <div className="bg-red-500 rounded-full p-1 mr-2">
                        <CreditCard className="h-4 w-4 text-white" />
                      </div>
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
