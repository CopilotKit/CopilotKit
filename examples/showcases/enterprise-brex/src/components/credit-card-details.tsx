import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, Lock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card as ICard, ExpensePolicy } from '../app/api/v1/data'

export function CreditCardDetails({
    card,
    policy,
    onChangePinModalOpen,
}: { card: ICard, policy?: ExpensePolicy, onChangePinModalOpen: () => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center">
                    <div className={`${card.color} rounded-full p-2 mr-2`}>
                        <CreditCard className="h-4 w-4 text-white" />
                    </div>
                    {card.type} ending in {card.last4}
                </CardTitle>
                <CardDescription>Expires {card.expiry}</CardDescription>
            </CardHeader>
            {policy ? (
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span>Credit Limit:</span>
                            <span className="font-semibold">${policy.limit}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Available Credit:</span>
                            <span className="font-semibold">${policy.limit - policy.spent}</span>
                        </div>
                    </div>
                </CardContent>
            ) : null}
            <CardFooter>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full">Manage Card</Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56">
                        <div className="grid gap-4">
                            <h4 className="font-medium leading-none">Card Options</h4>
                            <hr />
                            <Button variant="ghost" className="w-full justify-start" onClick={onChangePinModalOpen}>
                                <Lock className="mr-2 h-4 w-4" />
                                Change PIN
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </CardFooter>
        </Card>
    )
}