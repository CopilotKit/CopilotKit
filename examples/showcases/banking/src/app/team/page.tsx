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
import { useEffect, useReducer, useState } from "react";
import { TeamPageOperations } from "@/components/copilot-context";
import { useSearchParams } from "next/navigation";
import { useCopilotReadable, useHumanInTheLoop } from "@copilotkit/react-core";
import {
  AddOrEditMemberDialog,
  defaultDialogState,
  DialogState,
} from "@/components/add-or-edit-member-dialog";
import { RemoveMemberConfirmationDialog } from "@/components/remove-member-dialog";

function ApprovalButtons({
  onApprove,
  onDeny,
  approveLabel = "Approve",
  denyLabel = "Deny",
}: {
  onApprove: () => Promise<void> | void;
  onDeny: () => void;
  approveLabel?: string;
  denyLabel?: string;
}) {
  const [responded, setResponded] = useState(false);

  if (responded) {
    return <p className="text-sm text-gray-500 italic">Response submitted.</p>;
  }

  return (
    <div className="flex gap-2">
      <button
        className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        onClick={async () => {
          setResponded(true);
          await onApprove();
        }}
      >
        {approveLabel}
      </button>
      <button
        className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
        onClick={() => {
          setResponded(true);
          onDeny();
        }}
      >
        {denyLabel}
      </button>
    </div>
  );
}

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

  useHumanInTheLoop({
    followUp: false,
    name: "removeMember",
    description: "Remove a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
    parameters: [
      {
        name: "id",
        type: "string",
        description:
          "The ID of the member to remove (provided by copilot, ask questions to figure out the member)",
        required: true,
      },
    ],
    render: ({ args, respond, status }) => {
      const { id } = args;
      if (status === "inProgress") return <div>Loading...</div>;
      const member = team.find((m) => m.id === id);
      return (
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
          <h3 className="font-semibold text-lg">Remove Team Member</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Member:</span> {member?.name ?? id}</p>
            <p><span className="text-gray-500">Role:</span> {member?.role}</p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!id) {
                respond?.("Missing member information");
                return;
              }
              await removeMember(id);
              respond?.("Member removed successfully");
            }}
            onDeny={() => respond?.("Member removal denied by user")}
          />
        </div>
      );
    },
  });

  useHumanInTheLoop({
    followUp: false,
    name: "changeMemberRole",
    description: "Change the role of a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
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
    render: ({ args, respond, status }) => {
      const { id, role } = args;
      if (status === "inProgress") return <div>Loading...</div>;
      const member = team.find((m) => m.id === id);
      return (
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
          <h3 className="font-semibold text-lg">Change Member Role</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Member:</span> {member?.name ?? id}</p>
            <p><span className="text-gray-500">Current Role:</span> {member?.role}</p>
            <p><span className="text-gray-500">New Role:</span> {role}</p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!id || !role) {
                respond?.("Missing member or role information");
                return;
              }
              await changeMemberRole(id, role as MemberRole);
              respond?.("Role changed successfully");
            }}
            onDeny={() => respond?.("Role change denied by user")}
          />
        </div>
      );
    },
  });

  useHumanInTheLoop({
    followUp: false,
    name: "changeMemberTeam",
    description: "Change the team of a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
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
    render: ({ args, respond, status }) => {
      const { id, team: newTeam } = args;
      if (status === "inProgress") return <div>Loading...</div>;
      const member = team.find((m) => m.id === id);
      return (
        <div className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
          <h3 className="font-semibold text-lg">Change Member Team</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Member:</span> {member?.name ?? id}</p>
            <p><span className="text-gray-500">Current Team:</span> {member?.team}</p>
            <p><span className="text-gray-500">New Team:</span> {newTeam}</p>
          </div>
          <ApprovalButtons
            onApprove={async () => {
              if (!id || !newTeam) {
                respond?.("Missing member or team information");
                return;
              }
              await changeMemberTeam(id, newTeam as ExpenseRole);
              respond?.("Team changed successfully");
            }}
            onDeny={() => respond?.("Team change denied by user")}
          />
        </div>
      );
    },
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
