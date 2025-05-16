"use client";

import HomePage from "../HomePageComponent";
import { notFound } from "next/navigation";
import { AGENT_TYPE } from "@/config";
import { useParams } from "next/navigation";

export default function AgentPage() {
    const params = useParams();
    const agent = params.agent as string;
    if (AGENT_TYPE == "general") {
        if (agent == "crewai" || agent == "langgraph" || agent == "standard") {
            return <HomePage />;
        }
        else {
            notFound();
        }
    }
    else {
        if (agent == AGENT_TYPE) {
            return <HomePage />;
        }
        else {
            notFound();
        }
    }
}

