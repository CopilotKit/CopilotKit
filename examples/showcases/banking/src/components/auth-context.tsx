'use client'
import {createContext, useContext, useEffect, useState} from 'react';
import { Member } from "@/app/api/v1/data";
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
        throw new Error('useAuthContext must be used within an AuthContextProvider');
    }
    return context;
};

export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    const { team } = useTeam()
    const [currentUser, setCurrentUser] = useState<Member>(team[0]);

    useEffect(() => {
        if (currentUser) return;
        setCurrentUser(team[0])
    }, [team, currentUser]);

    if (!currentUser) return null;

    return (
        <AuthContext.Provider value={{ users: team, currentUser, setCurrentUser }}>
            {children}
        </AuthContext.Provider>
    );
};
