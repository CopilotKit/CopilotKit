"use client";
import useTeam from "@/app/team/actions";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthContext } from "@/components/auth-context";
import { ExpenseRole, MemberRole } from "@/app/api/v1/data";
import { useEffect, useReducer } from "react";
import { TeamPageOperations } from "@/components/copilot-context";
import { useSearchParams } from "next/navigation";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import {
  AddOrEditMemberDialog,
  defaultDialogState,
  DialogState,
} from "@/components/add-or-edit-member-dialog";
import { RemoveMemberConfirmationDialog } from "@/components/remove-member-dialog";

export default function Team() {
  const { currentUser } = useAuthContext();
  const {
    team,
    inviteMember,
    removeMember,
    changeMemberRole,
    changeMemberTeam,
  } = useTeam();
  const searchParams = useSearchParams();
  const operation = searchParams.get("operation") as TeamPageOperations | null;

  useCopilotReadable({
    description: "The available users of the system.",
    value: team,
  });

  useCopilotAction({
    name: "removeMember",
    description: "Remove a team member",
    parameters: [
      {
        name: "id",
        type: "string",
        description:
          "The ID of the member to remove (provided by copilot, ask questions to figure out the member)",
        required: true,
      },
    ],
    handler: ({ id }) => removeMember(id),
  });

  useCopilotAction({
    name: "changeMemberRole",
    description: "Change the role of a team member",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "The ID of the member to change the role of",
        required: true,
      },
      {
        name: "role",
        type: "string",
        description: "The new role of the member",
        required: true,
      },
    ],
    handler: ({ id, role }) => changeMemberRole(id, role as MemberRole),
  });

  useCopilotAction({
    name: "changeMemberTeam",
    description: "Change the team of a team member",
    parameters: [
      {
        name: "id",
        type: "string",
        description: "The ID of the member to change the team of",
        required: true,
      },
      {
        name: "team",
        type: "string",
        description: "The new team of the member",
        required: true,
      },
    ],
    handler: ({ id, team }) => changeMemberTeam(id, team as ExpenseRole),
  });

  const [dialogState, dispatchDialogState] = useReducer<
    React.Reducer<DialogState, Partial<DialogState>>
  >(
    (state: DialogState, payload: Partial<DialogState>) => ({
      ...state,
      ...payload,
    }),
    defaultDialogState
  );

  const handleAddMemberSubmit = () => {
    dispatchDialogState({ loading: true });
    void inviteMember(dialogState.email, dialogState.role, dialogState.team);
    dispatchDialogState({ dialogOpen: false, loading: false });
  };

  useEffect(() => {
    const operationNameToMethod: Partial<
      Record<TeamPageOperations, () => void>
    > = {
      [TeamPageOperations.InviteMember]: () =>
        dispatchDialogState({ dialogOpen: true }),
    };

    if (!operation || !Object.values(TeamPageOperations).includes(operation))
      return;
    operationNameToMethod[operation]?.();
  }, [operation]);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Team Management</h2>
        <Button
          onClick={() =>
            dispatchDialogState({ dialogOpen: true, action: "add" })
          }
        >
          <UserPlus className="mr-2 h-4 w-4" /> Invite Team Member
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {team.map((member) => (
          <Card key={member.id}>
            <CardHeader>
              <CardTitle>{member.name}</CardTitle>
              <CardDescription>{member.email}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Role:</span>
                  <span className="font-semibold">{member.role}</span>
                </div>
              </div>
            </CardContent>
            {currentUser.role === MemberRole.Admin ? (
              <CardFooter className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() =>
                    dispatchDialogState({
                      memberId: member.id,
                      dialogOpen: true,
                      action: "edit",
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    dispatchDialogState({
                      memberId: member.id,
                      dialogOpen: true,
                      action: "remove",
                    })
                  }
                >
                  Remove
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        ))}
      </div>
      <AddOrEditMemberDialog
        dialogState={dialogState}
        onStateChange={dispatchDialogState}
        onSubmit={handleAddMemberSubmit}
      />
      {dialogState.action === "remove" && (
        <RemoveMemberConfirmationDialog
          dialogState={dialogState}
          onStateChange={dispatchDialogState}
          onSubmit={async () => {
            await removeMember(dialogState.memberId!);
            dispatchDialogState(defaultDialogState);
          }}
          members={team}
        />
      )}
    </div>
  );
}
