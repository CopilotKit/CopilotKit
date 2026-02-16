import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Resource } from "@/lib/types";
import { truncateUrl } from "@/lib/utils";

type ResourcesProps = {
  resources: Resource[];
  customWidth?: number;
  handleCardClick?: (resource: Resource) => void;
  removeResource?: (url: string) => void;
};

export function Resources({
  resources,
  handleCardClick,
  removeResource,
  customWidth,
}: ResourcesProps) {
  return (
    <div data-test-id="resources" className="flex space-x-3 overflow-x-auto">
      {resources.map((resource, idx) => (
        <Card
          data-test-id={`resource`}
          key={idx}
          className={
            "text-md flex-none rounded-xl border-0 bg-background font-extralight shadow-none focus-visible:ring-0" +
            (handleCardClick ? "cursor-pointer" : "")
          }
          style={{ width: customWidth + "px" || "320px" }}
          onClick={() => handleCardClick?.(resource)}
        >
          <CardContent className="relative px-6 py-6">
            <div className="flex items-start space-x-3 text-sm">
              <div className="flex-grow">
                <h3
                  className="text-lg font-bold"
                  style={{
                    maxWidth: customWidth ? customWidth - 30 + "px" : "230px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {resource.title}
                </h3>
                <p
                  className="mt-2 text-base"
                  style={{
                    maxWidth: customWidth ? customWidth - 30 + "px" : "250px",
                    overflowWrap: "break-word",
                  }}
                >
                  {resource.description?.length > 250
                    ? resource.description.slice(0, 250) + "..."
                    : resource.description}
                </p>
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm text-primary text-slate-400 hover:underline"
                  title={resource.url}
                  style={{
                    width: customWidth ? customWidth - 30 + "px" : "250px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {resource.description && (
                    <>
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${resource.url}`}
                        alt="favicon"
                        className="mr-2 inline-block"
                        style={{ width: "16px", height: "16px" }}
                      />
                      {truncateUrl(resource.url)}
                    </>
                  )}
                </a>
              </div>
              {removeResource && (
                <div className="absolute right-4 top-4 flex items-start">
                  <Button
                    data-test-id="remove-resource"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeResource?.(resource.url);
                    }}
                    aria-label={`Remove ${resource.url}`}
                  >
                    <Trash2 className="h-6 w-6 text-gray-400 hover:text-red-500" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
