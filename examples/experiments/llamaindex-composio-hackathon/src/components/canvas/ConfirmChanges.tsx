"use client";
import { useEffect, useState } from "react";
import MarkdownIt from "markdown-it";
import { diffWords } from "diff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";


interface ConfirmChangesProps {
    args: any;
    respond: any;
    status: any;
    onReject: () => void;
    onConfirm: () => void;
    currentDocument: string;
    setCurrentDocument: (state: any) => void;
}

export function ConfirmChanges({ args, respond, status, onReject, onConfirm, currentDocument, setCurrentDocument }: ConfirmChangesProps) {
    function fromMarkdown(text: string) {
        const md = new MarkdownIt({
            typographer: true,
            html: true,
        });

        return md.render(text);
    }
    function diffPartialText(
        oldText: string,
        newText: string,
        isComplete: boolean = false
    ) {
        let oldTextToCompare = oldText;
        if (oldText.length > newText.length && !isComplete) {
            // make oldText shorter
            oldTextToCompare = oldText.slice(0, newText.length);
        }

        const changes = diffWords(oldTextToCompare, newText);

        let result = "";
        changes.forEach((part) => {
            if (part.added) {
                result += `<em>${part.value}</em>`;
            } else if (part.removed) {
                result += `<s>${part.value}</s>`;
            } else {
                result += part.value;
            }
        });

        if (oldText.length > newText.length && !isComplete) {
            result += oldText.slice(newText.length);
        }

        return result;
    }

    useEffect(() => {
        if (!currentDocument) {
            setCurrentDocument((prev: any) => ({ ...prev, story: args?.story || "" }));
            return;
        }
        const diff = diffPartialText(currentDocument, args?.story || "");
        setCurrentDocument((prev: any) => ({ ...prev, story: diff }));
    }, [args?.story])

    const [accepted, setAccepted] = useState<boolean | null>(null);
    if (status != 'inProgress') {
        return (
            <div className="w-full max-w-xl rounded-2xl border bg-card shadow-sm mt-5 mb-5">
                <div className="p-4 border-b bg-accent/5 rounded-t-2xl">
                    <h2 className="text-base font-semibold">Confirm Changes</h2>
                </div>
                <div className="p-4">
                    <p className="text-sm text-muted-foreground">Do you want to accept the changes?</p>
                </div>
                <div className="p-4 pt-0 flex justify-end gap-2">
                    {accepted === null ? (
                        <>
                            <Button
                                variant="outline"
                                disabled={status !== "executing"}
                                onClick={() => {
                                    if (respond) {
                                        setAccepted(false);
                                        onReject();
                                        respond("Changes rejected");
                                    }
                                }}
                            >
                                Reject
                            </Button>
                            <Button
                                disabled={status !== "executing"}
                                onClick={() => {
                                    if (respond) {
                                        setAccepted(true);
                                        onConfirm();
                                        respond("Changes accepted");
                                    }
                                }}
                            >
                                Confirm
                            </Button>
                        </>
                    ) : (
                        <span
                            className={cn(
                                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                                accepted
                                    ? "bg-accent/10 text-accent border-accent/40"
                                    : "bg-muted text-muted-foreground border-border"
                            )}
                        >
                            {accepted ? "Accepted" : "Rejected"}
                        </span>
                    )}
                </div>
            </div>
        );
    }
    else {
        return null;
    }
}