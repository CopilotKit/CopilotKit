import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Member } from "@/app/api/v1/data";
import { defaultDialogState, MemberDialogProps } from "@/components/add-or-edit-member-dialog";

export function RemoveMemberConfirmationDialog({
    onStateChange,
    onSubmit,
    dialogState,
    members,
}: MemberDialogProps & { members: Member[] }) {
    const member = members.find(m => m.id === dialogState.memberId) as Member;
    return (
        <Dialog open={dialogState.dialogOpen && dialogState.action === 'remove'}
                onOpenChange={open => onStateChange(open ? { dialogOpen: open } : defaultDialogState)}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Are you sure?</DialogTitle>
                    <DialogDescription>
                        This will remove {member.name} entirely.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="submit"
                        onClick={() => onSubmit()}
                        variant="destructive"
                    >
                        Confirm
                    </Button>
                    <Button
                        type="submit"
                        variant="outline"
                        onClick={() => onStateChange(defaultDialogState)}
                    >
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
