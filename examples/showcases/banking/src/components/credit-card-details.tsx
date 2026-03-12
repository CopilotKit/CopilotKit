import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card as ICard, CardBrand, ExpensePolicy } from '../app/api/v1/data'

function VisaLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 780 500" xmlns="http://www.w3.org/2000/svg">
            <path d="M293.2 348.7l33.4-195.8h53.4l-33.4 195.8zM540.7 157.2c-10.6-4-27.2-8.3-47.9-8.3-52.8 0-90 26.6-90.2 64.6-.3 28.1 26.5 43.8 46.8 53.2 20.8 9.6 27.8 15.7 27.7 24.3-.1 13.1-16.6 19.1-32 19.1-21.4 0-32.7-3-50.3-10.2l-6.9-3.1-7.5 43.8c12.5 5.5 35.6 10.2 59.6 10.5 56.2 0 92.6-26.3 93-66.8.2-22.3-14-39.2-44.8-53.2-18.6-9.1-30.1-15.1-30-24.3 0-8.1 9.7-16.8 30.6-16.8 17.4-.3 30.1 3.5 39.9 7.5l4.8 2.3 7.2-42.7zM676.3 152.9h-41.3c-12.8 0-22.4 3.5-28 16.3l-79.4 179.5h56.2s9.2-24.2 11.3-29.5c6.1 0 60.8.1 68.6.1 1.6 6.9 6.5 29.4 6.5 29.4h49.7l-43.6-195.8zm-65.8 126.3c4.4-11.3 21.4-54.8 21.4-54.8-.3.5 4.4-11.4 7.1-18.8l3.6 17s10.3 47 12.4 56.6h-44.5zM232.2 152.9L180 283.6l-5.6-27c-9.7-31.2-39.9-65-73.7-81.9l47.9 173.8h56.6l84.2-195.6h-57.2" fill="#1a1f71"/>
            <path d="M131.9 152.9H46.3l-.7 3.8c67.1 16.2 111.5 55.4 129.9 102.5L157.2 169c-3.2-12.5-12.7-15.7-25.3-16.1" fill="#f7a600"/>
        </svg>
    );
}

function MastercardLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 780 500" xmlns="http://www.w3.org/2000/svg">
            <circle cx="312" cy="250" r="200" fill="#eb001b"/>
            <circle cx="468" cy="250" r="200" fill="#f79e1b"/>
            <path d="M390 100.2c-49.7 38.3-81.6 98.1-81.6 165.8s31.9 127.5 81.6 165.8c49.7-38.3 81.6-98.1 81.6-165.8S439.7 138.5 390 100.2z" fill="#ff5f00"/>
        </svg>
    );
}

export function CreditCardDetails({
    card,
    policy,
    onChangePinModalOpen,
}: { card: ICard, policy?: ExpensePolicy, onChangePinModalOpen: () => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center">
                    {card.type === CardBrand.Visa ? (
                        <div className="bg-white border rounded-md p-1 mr-2 flex items-center justify-center w-10 h-7">
                            <VisaLogo className="h-5" />
                        </div>
                    ) : (
                        <div className="bg-white border rounded-md p-1 mr-2 flex items-center justify-center w-10 h-7">
                            <MastercardLogo className="h-5" />
                        </div>
                    )}
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