"use client"

import { useEffect, useState } from "react"
import { WorkspaceToolbar } from "@/components/workspace-toolbar"
import { ResearcherWorkspace } from "@/components/workspaces/researcher-workspace"
import { PlannerWorkspace } from "@/components/workspaces/planner-workspace"
import { CoderWorkspace } from "@/components/workspaces/haiku-workspace"
import type { AgentType } from "@/lib/types"
import { useCoAgent, useCoAgentStateRender, useCopilotAction } from "@copilotkit/react-core"
import { Progress } from "@/components/research-progress"
import { Button } from "./ui/button"
import { Dialog, DialogTitle, DialogContent } from "@radix-ui/react-dialog"
import { DialogFooter, DialogHeader } from "./ui/dialog"
import { useAgent } from "@/lib/agent-provider"
interface WorkspaceProps {
  selectedAgent: AgentType
  lastMessage: string
}

export function Workspace({ selectedAgent, lastMessage }: WorkspaceProps) {
  const [isAgentActive, setIsAgentActive] = useState(false)
  const [haikus, setHaikus] = useState<{ japanese: string[], english: string[], image_names: string[], selectedImage: string | null }[]>([{
    japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
    english: [
      "A placeholder verse—",
      "even in a blank canvas,",
      "it beckons flowers.",
    ],
    image_names: [],
    selectedImage: null,
  }])
  const { currentAgent, setAgents } = useAgent()
  const [workspaceContent, setWorkspaceContent] = useState("Start your research here... The agent will help you gather information, analyze findings, and structure your research.")
  const { state, setState } = useCoAgent({
    name: currentAgent?.id,
    initialState: currentAgent?.id === "langgraphAgent" ? {
      research_question: "",
      report: "",
      resources: [] as { title: string, url: string, description: string }[],
      logs: []
    } : currentAgent?.id === "mastraAgent" ? {
      haiku: {
        japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
        english: [
          "A placeholder verse—",
          "even in a blank canvas,",
          "it beckons flowers.",
        ],
        image_names: [],
        selectedImage: null,
      }
    } : {
      haiku: "",
      logs: []
    }
  })

  useCoAgentStateRender({
    name: "langgraphAgent",
    render: ({ state }: any) => {
      useEffect(() => {
        console.log(state);
      }, [state])
      return (
        <Progress logs={state?.logs || []} />
      )
    }
  })

  useCoAgentStateRender({
    name: "mastraAgent",
    render: ({ state }: any) => {
      useEffect(() => {
        console.log(state);
        if (state?.english[0] != "A placeholder verse—") {
          setHaikus((prev) => [...prev, state])
        }
      }, [state])
      return (
        <></>
      )
    }
  })


  // useCopilotAction({
  //   name: "DeleteResources",
  //   description: "Delete a resource from the research",
  //   parameters: [{
  //     name: "urls",
  //     type: "string[]",
  //     description: "The url of the resource to delete"
  //   }],
  //   renderAndWaitForResponse: ({ args, respond, result }) => {
  //     useEffect(() => {
  //       console.log(args, "ArgsArgsArgs");
  //     }, [args])
  //     return (
  //       <div>
  //         <Dialog open={true}>
  //           <DialogContent>
  //             <DialogHeader>
  //               <DialogTitle>Confirm Deletion</DialogTitle>
  //             </DialogHeader>
  //             <div className="py-2">
  //               Are you sure you want to delete the following sources?
  //               <ul className="list-disc pl-6 mt-2 text-sm text-muted-foreground">
  //                 {args?.urls?.map(url => (
  //                   <li key={url}>{url}</li>
  //                 ))}
  //               </ul>
  //             </div>
  //             <DialogFooter>
  //               <Button variant="ghost" onClick={() => {
  //                 if (respond) {
  //                   respond("resources not deleted")
  //                 }
  //               }}>Cancel</Button>
  //               <Button variant="destructive" onClick={() => {
  //                 setState({
  //                   ...state,
  //                   resources: state.resources.filter((r: { url: string }) => !args?.urls?.includes(r.url))
  //                 })
  //                 if (respond) {
  //                   respond("resources deleted successfully")
  //                 }
  //               }}>Confirm</Button>
  //             </DialogFooter>
  //           </DialogContent>
  //         </Dialog>
  //       </div>
  //     )
  //   }
  // })

  const handleAddSource = (sources: { title: string, url: string, description: string }[]) => {
    if (state?.resources) {
      setState({
        ...state,
        resources: [...sources]
      })
    }
  }

  useEffect(() => {
    console.log(state);
  }, [state])
  const renderWorkspace = () => {
    switch (currentAgent?.id) {
      case "langgraphAgent":
        return (
          <ResearcherWorkspace
            sources={state?.resources || []}
            setSources={handleAddSource}
            content={state?.report || workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
      case "Planner":
        return (
          <PlannerWorkspace
            content={workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
      case "mastraAgent":
        return (
          <CoderWorkspace
            haikus={haikus}
            // content={workspaceContent}
            setContent={setWorkspaceContent}
            lastMessage={lastMessage}
            isAgentActive={isAgentActive}
          />
        )
    }
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceToolbar
        selectedAgent={selectedAgent}
        isAgentActive={isAgentActive}
        setIsAgentActive={setIsAgentActive}
      />
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-6xl">{renderWorkspace()}</div>
      </div>
    </main>
  )
}
