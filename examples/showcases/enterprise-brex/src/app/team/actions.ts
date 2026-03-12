import { ExpenseRole, Member, MemberRole } from "@/app/api/v1/data";
import { useEffect, useState } from "react";

export default function useTeam() {
  const [team, setTeam] = useState<Member[]>([]);

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/v1/users");
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();
      setTeam(data);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const removeMember = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/users/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const inviteMember = async (
    email: string,
    role: MemberRole,
    team: ExpenseRole
  ) => {
    try {
      const response = await fetch(`/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, role, team }),
      });
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      await response.json();
      void fetchUsers();
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const changeMemberRole = async (id: string, role: MemberRole) => {
    try {
      const response = await fetch(`/api/v1/users/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      await response.json();
      void fetchUsers();
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  const changeMemberTeam = async (id: string, team: ExpenseRole) => {
    try {
      const response = await fetch(`/api/v1/users/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ team }),
      });
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      await response.json();
      void fetchUsers();
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  return {
    team,
    inviteMember,
    removeMember,
    changeMemberRole,
    changeMemberTeam,
  };
}
