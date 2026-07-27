"use client";
import { createContext, useContext, useState } from "react";
import type { Member } from "@/app/api/v1/data";
import useTeam from "@/app/team/actions";

interface AuthContextType {
  users: Member[];
  currentUser: Member;
  setCurrentUser: (user: Member) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error(
      "useAuthContext must be used within an AuthContextProvider",
    );
  }
  return context;
};

export const AuthContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { team } = useTeam();
  const [selectedUser, setSelectedUser] = useState<Member | undefined>();
  const currentUser = selectedUser ?? team[0];

  if (!currentUser) return null;

  return (
    <AuthContext.Provider
      value={{ users: team, currentUser, setCurrentUser: setSelectedUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};
