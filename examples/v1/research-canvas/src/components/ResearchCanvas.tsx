"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCoAgent,
  useCoAgentStateRender,
  useCopilotAction,
} from "@copilotkit/react-core";
import { Progress } from "./Progress";
import { EditResourceDialog } from "./EditResourceDialog";
import { AddResourceDialog } from "./AddResourceDialog";
import { Resources } from "./Resources";
import { AgentState, Resource } from "@/lib/types";
import { useModelSelectorContext } from "@/lib/model-selector-provider";

export function ResearchCanvas() {
  const { model, agent } = useModelSelectorContext();

  const { state, setState } = useCoAgent<AgentState>({
    name: agent,
    initialState: {
      model,
    },
  });

  useCoAgentStateRender({
    name: agent,
    render: ({ state, nodeName, status }) => {
      if (!state.logs || state.logs.length === 0) {
        return null;
      }
      return <Progress logs={state.logs} />;
    },
  });

  useCopilotAction({
    name: "DeleteResources",
    description:
      "Prompt the user for resource delete confirmation, and then perform resource deletion",
    available: "remote",
    parameters: [
      {
        name: "urls",
        type: "string[]",
      },
    ],
    renderAndWait: ({ args, status, handler }) => {
      return (
        <div
          className=""
          data-test-id="delete-resource-generative-ui-container"
        >
          <div className="mb-2 text-base font-bold">
            Delete these resources?
          </div>
          <Resources
            resources={resources.filter((resource) =>
              (args.urls || []).includes(resource.url),
            )}
            customWidth={200}
          />
          {status === "executing" && (
            <div className="mt-4 flex justify-start space-x-2">
              <button
                onClick={() => handler("NO")}
                className="rounded border border-[#6766FC] px-4 py-2 text-sm font-bold text-[#6766FC]"
              >
                Cancel
              </button>
              <button
                data-test-id="button-delete"
                onClick={() => handler("YES")}
                className="rounded bg-[#6766FC] px-4 py-2 text-sm font-bold text-white"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      );
    },
  });

  const resources: Resource[] = state.resources || [];
  const setResources = (resources: Resource[]) => {
    setState({ ...state, resources });
  };

  // const [resources, setResources] = useState<Resource[]>(dummyResources);
  const [newResource, setNewResource] = useState<Resource>({
    url: "",
    title: "",
    description: "",
  });
  const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);

  const addResource = () => {
    if (newResource.url) {
      setResources([...resources, { ...newResource }]);
      setNewResource({ url: "", title: "", description: "" });
      setIsAddResourceOpen(false);
    }
  };

  const removeResource = (url: string) => {
    setResources(
      resources.filter((resource: Resource) => resource.url !== url),
    );
  };

  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [isEditResourceOpen, setIsEditResourceOpen] = useState(false);

  const handleCardClick = (resource: Resource) => {
    setEditResource({ ...resource }); // Ensure a new object is created
    setOriginalUrl(resource.url); // Store the original URL
    setIsEditResourceOpen(true);
  };

  const updateResource = () => {
    if (editResource && originalUrl) {
      setResources(
        resources.map((resource) =>
          resource.url === originalUrl ? { ...editResource } : resource,
        ),
      );
      setEditResource(null);
      setOriginalUrl(null);
      setIsEditResourceOpen(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F5F8FF] p-10">
      <div className="space-y-8 pb-10">
        <div>
          <h2 className="mb-3 text-lg font-medium text-primary">
            Research Question
          </h2>
          <Input
            placeholder="Enter your research question"
            value={state.research_question || ""}
            onChange={(e) =>
              setState({ ...state, research_question: e.target.value })
            }
            aria-label="Research question"
            className="text-md rounded-xl border-0 bg-background px-6 py-8 font-extralight shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-primary">Resources</h2>
            <EditResourceDialog
              isOpen={isEditResourceOpen}
              onOpenChange={setIsEditResourceOpen}
              editResource={editResource}
              setEditResource={setEditResource}
              updateResource={updateResource}
            />
            <AddResourceDialog
              isOpen={isAddResourceOpen}
              onOpenChange={setIsAddResourceOpen}
              newResource={newResource}
              setNewResource={setNewResource}
              addResource={addResource}
            />
          </div>
          {resources.length === 0 && (
            <div className="text-sm text-slate-400">
              Click the button above to add resources.
            </div>
          )}

          {resources.length !== 0 && (
            <Resources
              resources={resources}
              handleCardClick={handleCardClick}
              removeResource={removeResource}
            />
          )}
        </div>

        <div className="flex h-full flex-col">
          <h2 className="mb-3 text-lg font-medium text-primary">
            Research Draft
          </h2>
          <Textarea
            data-test-id="research-draft"
            placeholder="Write your research draft here"
            value={state.report || ""}
            onChange={(e) => setState({ ...state, report: e.target.value })}
            rows={10}
            aria-label="Research draft"
            className="text-md rounded-xl border-0 bg-background px-6 py-8 font-extralight shadow-none placeholder:text-slate-400 focus-visible:ring-0"
            style={{ minHeight: "200px" }}
          />
        </div>
      </div>
    </div>
  );
}
