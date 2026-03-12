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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExpenseRole, MemberRole } from "@/app/api/v1/data";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface DialogState {
    email: string;
    role: MemberRole;
    team: ExpenseRole;
    loading: boolean;
    dialogOpen: boolean;
    memberId: string | null,
    action: 'add' | 'edit' | 'remove'
}

export const defaultDialogState = {
    email: '',
    role: MemberRole.Member,
    team: ExpenseRole.Marketing,
    loading: false,
    dialogOpen: false,
    memberId: null,
    action: 'add' as DialogState['action'],
}

export interface MemberDialogProps {
    onStateChange: (payload: Partial<DialogState>) => void;
    onSubmit: () => void;
    dialogState: DialogState;
}

export function AddOrEditMemberDialog({
    onStateChange,
    onSubmit,
    dialogState,
}: MemberDialogProps) {
    const isEdit = dialogState.action === 'edit';
    return (
        <Dialog
            open={dialogState.dialogOpen && (isEdit ? !!dialogState.memberId : !dialogState.memberId)}
            onOpenChange={open => onStateChange(open ? { dialogOpen: open } : defaultDialogState)}
        >
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Member' : 'Invite Member'}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? 'Edit the team or role of a member' : 'Enter the email, role, and team for the new member.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {!isEdit && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="email" className="text-right">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                value={dialogState.email}
                                onChange={(e) => onStateChange({ email: e.target.value })}
                                className="col-span-3"
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="role" className="text-right">
                            Role
                        </Label>
                        <Select onValueChange={(value) => onStateChange({ role: value as MemberRole })}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={MemberRole.Admin}>Admin</SelectItem>
                                    <SelectItem value={MemberRole.Member}>Member</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="team" className="text-right">
                            Team
                        </Label>
                        <Select onValueChange={(value) => onStateChange({ team: value as ExpenseRole })}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select a team" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={ExpenseRole.Marketing}>Marketing</SelectItem>
                                    <SelectItem value={ExpenseRole.Engineering}>Engineering</SelectItem>
                                    <SelectItem value={ExpenseRole.Executive}>Executive</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="submit"
                        onClick={() => onSubmit()}
                    >
                        {dialogState.loading ? (<Loader2 className="mr-2 h-4 w-4 animate-spin"/>) : isEdit ? 'Edit Member' : 'Invite Member'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}