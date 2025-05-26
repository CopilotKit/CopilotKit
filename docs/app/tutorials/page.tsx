import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, GraduationCap } from "lucide-react";
import { SiLangchain } from "react-icons/si";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { AG2Icon, MastraIcon } from "@/lib/icons/custom-icons";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "CopilotKit Tutorials",
  description: "Learn how to build AI agents with step-by-step tutorials for different frameworks",
};

export default function TutorialsPage(): JSX.Element {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">CopilotKit Tutorials</h1>
        <p className="text-xl text-muted-foreground">
          Learn how to build AI agents with step-by-step tutorials for different frameworks
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Standard Agent */}
        <Link href="/tutorials/standard-agent/getting-started" className="no-underline">
          <Card className="h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-md bg-gradient-to-b from-indigo-700 to-indigo-400">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <CardTitle>The Standard Agent</CardTitle>
              </div>
              <CardDescription>
                Build your first Copilot with the Standard Agent
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1">
                <li>Getting Started with Standard Agent</li>
                <li>Adding Custom Tools</li>
                <li>Integrating with Your Application</li>
              </ul>
            </CardContent>
          </Card>
        </Link>

        {/* LangGraph */}
        <Link href="/tutorials/langgraph/basic" className="no-underline">
          <Card className="h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-md bg-gradient-to-b from-purple-700 to-purple-400">
                  <SiLangchain className="w-5 h-5 text-white" />
                </div>
                <CardTitle>LangGraph</CardTitle>
              </div>
              <CardDescription>
                Create advanced agents with LangGraph
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1">
                <li>Basic LangGraph Tutorial</li>
                <li>Building Complex Workflows</li>
                <li>State Management</li>
              </ul>
            </CardContent>
          </Card>
        </Link>

        {/* CrewAI */}
        <Link href="/tutorials/crewai/flows" className="no-underline">
          <Card className="h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-md bg-gradient-to-b from-[#FA694C] to-[#FE8A71]">
                  <SiCrewai className="w-5 h-5 text-white" />
                </div>
                <CardTitle>CrewAI</CardTitle>
              </div>
              <CardDescription>
                Build multi-agent systems with CrewAI
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1">
                <li>CrewAI Flows Tutorial</li>
                <li>CrewAI Crews Tutorial</li>
                <li>Agent Collaboration Patterns</li>
              </ul>
            </CardContent>
          </Card>
        </Link>

        {/* Mastra */}
        <Link href="/tutorials/mastra/basic" className="no-underline">
          <Card className="h-full hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-md bg-gradient-to-b from-black to-zinc-800">
                  <MastraIcon className="w-5 h-5 text-white" />
                </div>
                <CardTitle>Mastra</CardTitle>
              </div>
              <CardDescription>
                Learn how to use Mastra for agent development
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1">
                <li>Basic Mastra Tutorial</li>
                <li>Advanced Features</li>
                <li>Integration with CopilotKit</li>
              </ul>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
