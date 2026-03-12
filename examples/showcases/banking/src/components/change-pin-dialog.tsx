import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {CreditCard, Loader2} from "lucide-react";
import {useState} from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/app/api/v1/data";

export function ChangePinDialog({
    onDialogOpenChange,
    dialogOpen,
    loading,
    onSubmit,
    cards,
}: {
    onDialogOpenChange: (open: boolean) => void;
    dialogOpen: boolean;
    loading: boolean;
    onSubmit: (args: { pin: string; cardId?: string }) => void;
    cards: Card[]
}) {
    const [pin, setPin] = useState('')
    const [cardId, setCardId] = useState('')
    return (
        <Dialog open={dialogOpen}
                onOpenChange={onDialogOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Change PIN</DialogTitle>
                    <DialogDescription>
                        Enter your new 4-digit PIN below. Make sure it&#39;s something you can remember but hard for others to
                        guess.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                Choose card
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                {cards.map(card => (
                                    <DropdownMenuItem key={card.id} onClick={() => setCardId(card.id)}>
                                        <div className="flex items-center">
                                            <div className="bg-blue-500 rounded-full p-1 mr-2">
                                                <CreditCard className="h-4 w-4 text-white"/>
                                            </div>
                                            {card.type} - {card.last4}
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="pin" className="text-right">
                            New PIN
                        </Label>
                        <Input
                            id="pin"
                            type="password"
                            maxLength={4}
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="submit"
                        onClick={() => onSubmit({ pin, cardId })}
                    >
                        {loading ? (<Loader2 className="mr-2 h-4 w-4 animate-spin"/>) : 'Confirm Change'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}