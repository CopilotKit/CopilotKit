"use client";
import useTeam from "@/skins/banking/team-actions";
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
import { useAuthContext } from "@/skins/banking/components/auth-context";
import type { ExpenseRole } from "@/skins/banking/data/data";
import { MemberRole } from "@/skins/banking/data/data";
import { useEffect, useReducer } from "react";
import { TeamPageOperations } from "@/skins/banking/tools";
import { useSearchParams } from "next/navigation";
import { useAgentContext, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { DialogState } from "@/skins/banking/components/add-or-edit-member-dialog";
import {
  AddOrEditMemberDialog,
  defaultDialogState,
} from "@/skins/banking/components/add-or-edit-member-dialog";
import { RemoveMemberConfirmationDialog } from "@/skins/banking/components/remove-member-dialog";
import { ApprovalButtons } from "@/skins/banking/components/approval-buttons";

const dialogStateReducer = (
  state: DialogState,
  payload: Partial<DialogState>,
): DialogState => ({
  ...state,
  ...payload,
});

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

  // What the Team page ACTUALLY renders, labelled as the UI labels it. The old
  // readable here ("the available users of the system") described the DATA, so
  // "what's on my screen?" on this route answered from a bare user list with no
  // idea what page it was on or what was displayed. Mirrors the Cards and
  // Charges pages so screen-awareness is truthful on every route.
  useAgentContext({
    description:
      "The Team Management page the user is currently viewing, exactly as " +
      "rendered: the heading, the primary action, and one card per teammate " +
      "showing their name, email, role and team. Use this to answer questions " +
      "about what is on screen here.",
    value: JSON.stringify({
      page: "team",
      heading: "Team Management",
      subheading: "Invite teammates and manage roles & departments.",
      primaryAction: "Invite Team Member",
      visibleMembers: team.map((member) => ({
        name: member.name,
        email: member.email,
        role: member.role,
        team: member.team,
      })),
    }),
  });

  useHumanInTheLoop({
    followUp: false,
    name: "removeMember",
    description:
      "Remove a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
    parameters: z.object({
      id: z
        .string()
        .describe(
          "The ID of the member to remove (provided by copilot, ask questions to figure out the member)",
        ),
    }),
    render: ({ args, respond, status }) => {
      const { id } = args;
      if (status === "inProgress")
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      const member = team.find((m) => m.id === id);
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="font-semibold text-lg">Remove Team Member</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Member:</span>{" "}
              {member?.name ?? id}
            </p>
            <p>
              <span className="text-ink-muted">Role:</span> {member?.role}
            </p>
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
    description:
      "Change the role of a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
    parameters: z.object({
      id: z.string().describe("The ID of the member to change the role of"),
      role: z.string().describe("The new role of the member"),
    }),
    render: ({ args, respond, status }) => {
      const { id, role } = args;
      if (status === "inProgress")
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      const member = team.find((m) => m.id === id);
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="font-semibold text-lg">Change Member Role</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Member:</span>{" "}
              {member?.name ?? id}
            </p>
            <p>
              <span className="text-ink-muted">Current Role:</span>{" "}
              {member?.role}
            </p>
            <p>
              <span className="text-ink-muted">New Role:</span> {role}
            </p>
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
    description:
      "Change the team of a team member. Do NOT ask for confirmation - just call this action immediately. The approval UI will handle user confirmation.",
    parameters: z.object({
      id: z.string().describe("The ID of the member to change the team of"),
      team: z.string().describe("The new team of the member"),
    }),
    render: ({ args, respond, status }) => {
      const { id, team: newTeam } = args;
      if (status === "inProgress")
        return (
          <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
            Loading…
          </div>
        );
      const member = team.find((m) => m.id === id);
      return (
        <div className="space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
          <h3 className="font-semibold text-lg">Change Member Team</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="text-ink-muted">Member:</span>{" "}
              {member?.name ?? id}
            </p>
            <p>
              <span className="text-ink-muted">Current Team:</span>{" "}
              {member?.team}
            </p>
            <p>
              <span className="text-ink-muted">New Team:</span> {newTeam}
            </p>
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

  const [dialogState, dispatchDialogState] = useReducer(
    dialogStateReducer,
    defaultDialogState,
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
    <div className="mx-auto max-w-7xl space-y-6 px-2 pb-4 md:px-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">
            Team Management
          </h2>
          <p className="text-sm text-ink-muted">
            Invite teammates and manage roles &amp; departments.
          </p>
        </div>
        <Button
          onClick={() =>
            dispatchDialogState({ dialogOpen: true, action: "add" })
          }
        >
          <UserPlus className="mr-2 h-4 w-4" /> Invite Team Member
        </Button>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {team.map((member) => (
          <Card key={member.id} className="p-2">
            <CardHeader>
              <CardTitle className="text-ink">{member.name}</CardTitle>
              <CardDescription>{member.email}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Role</span>
                <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-indigo dark:text-brand-violet">
                  {member.role}
                </span>
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
