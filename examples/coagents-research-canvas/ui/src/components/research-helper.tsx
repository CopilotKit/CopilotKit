"use client";

import { useState } from "react";
import { Plus, Trash2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useCoAgent,
  useCoagentStateRender,
  useCopilotAction,
} from "@copilotkit/react-core";
import { Progress } from "./Progress";

type Resource = {
  url: string;
};

const truncateUrl = (url: string, maxLength: number = 40) => {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + "...";
};

export function ResearchHelperComponent() {
  const { state, setState } = useCoAgent({
    name: "research_agent",
  });

  useCoagentStateRender({
    name: "research_agent",
    render: ({ state }) => {
      if (!state.logs || state.logs.length === 0) {
        return null;
      }
      return <Progress logs={state.logs} />;
    },
  });

  useCopilotAction({
    name: "DeleteResources",
    disabled: true,
    parameters: [
      {
        name: "urls",
        type: "string[]",
      },
    ],
    renderAndWait: ({ args, status, handler }) => {
      return (
        <div className="p-4 bg-gray-100 rounded-lg">
          <div className="font-bold text-lg mb-2">Delete these resources?</div>
          <div className="text-gray-700">
            {(args.urls || []).map((url) => (
              <div key={url} className="text-xs">
                • {truncateUrl(url)}
              </div>
            ))}
          </div>
          {status === "executing" && (
            <div className="mt-4 flex justify-end space-x-2">
              <button
                onClick={() => handler("NO")}
                className="px-4 py-2 bg-slate-400 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => handler("YES")}
                className="px-4 py-2 bg-blue-500 text-white rounded"
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
  });
  const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);

  const addResource = () => {
    if (newResource.url) {
      setResources([...resources, { ...newResource }]);
      setNewResource({ url: "" });
      setIsAddResourceOpen(false);
    }
  };

  const removeResource = (url: string) => {
    setResources(
      resources.filter((resource: Resource) => resource.url !== url)
    );
  };

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <h1 className="text-3xl font-extralight mb-8 text-center tracking-tight">
        Research Helper
      </h1>
      <div className="space-y-8">
        <div>
          <h2 className="text-xl font-light mb-3 text-primary">
            Research Question
          </h2>
          <Input
            placeholder="Enter your research question"
            value={state.research_question || ""}
            onChange={(e) =>
              setState({ ...state, research_question: e.target.value })
            }
            aria-label="Research question"
            className="bg-background"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-light text-primary">Resources</h2>
            <Dialog
              open={isAddResourceOpen}
              onOpenChange={setIsAddResourceOpen}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-sm">
                  <Plus className="w-4 h-4 mr-2" /> Add Resource
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Add New Resource</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <Input
                    placeholder="Resource URL"
                    value={newResource.url || ""}
                    onChange={(e) =>
                      setNewResource({ ...newResource, url: e.target.value })
                    }
                    aria-label="New resource URL"
                    className="bg-background"
                  />
                </div>
                <Button onClick={addResource} className="w-full">
                  <Plus className="w-4 h-4 mr-2" /> Add Resource
                </Button>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="bg-background shadow-sm">
            <CardContent className="p-4">
              <ul className="space-y-3">
                {resources.length == 0 && (
                  <div className="text-sm">
                    To add resources, click add resource above.
                  </div>
                )}
                {resources.map((resource) => (
                  <li
                    key={resource.url}
                    className="flex items-start space-x-3 text-sm"
                  >
                    <BookOpen className="w-4 h-4 mt-1 flex-shrink-0 text-primary" />
                    <div className="flex-grow">
                      {/* <h3 className="font-medium">{resource.title}</h3> */}
                      {/* <p className="text-muted-foreground text-xs mt-0.5">
                        {resource.description}
                      </p> */}
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mt-0.5 inline-block"
                        title={resource.url}
                      >
                        {truncateUrl(resource.url)}
                      </a>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeResource(resource.url)}
                      aria-label={`Remove ${resource.url}`}
                      className="mt-0.5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-xl font-light mb-3 text-primary">
            Research Draft
          </h2>
          <Textarea
            placeholder="Write your research draft here"
            value={state.report || ""}
            onChange={(e) => setState({ ...state, report: e.target.value })}
            rows={10}
            aria-label="Research draft"
            className="bg-background"
          />
        </div>
      </div>
    </div>
  );
}
