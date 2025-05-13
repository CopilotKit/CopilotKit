import { useCopilotChat } from "@copilotkit/react-core"
import { useEffect, useState } from "react"
import { Spinner } from "./page"

export const Steps = ({ status, args }: any) => {
    console.log(status, args, "STATUS AND ARGS")
    const [steps, setSteps] = useState(args?.steps)


    const {} = useCopilotChat()

    useEffect(() => {
        if (status !== "complete") return;

        (async () => {
            for (let i = 0; i < steps.length; i++) {
                debugger
                await delay(1000);
                setSteps((prev: any) =>
                    prev.map((step: any, idx: number) =>
                        idx === i ? { ...step, status: "completed" } : step
                    )
                );
            }
        })();
    }, [status, args.steps]);

    async function updateStep(index: number) {
        debugger
        await delay(2000)
        let updatedStep = steps
        updatedStep[index].status = "completed"
        setSteps(updatedStep)
    }
    return (
        // (status == 'complete') ? args?.steps?.map((step: any, index: number) => {
        //     return (
        <div className="flex">
            <div className="bg-gray-100 rounded-lg w-[500px] p-4 text-black space-y-2">
                {steps.map((step: any, index: number) => {
                    if (step.status === "completed") {
                        return (
                            <div key={index} className="text-sm">
                                ✓ {step.description}
                            </div>
                        );
                    } else if (
                        step.status === "pending" &&
                        index === steps.findIndex((s: any) => s.status === "pending")
                    ) {
                        return (
                            <div
                                key={index}
                                className="text-3xl font-bold text-slate-700"
                            >
                                <Spinner />
                                {step.description}
                            </div>
                        );
                    } else {
                        return (
                            <div key={index} className="text-sm">
                                <Spinner />
                                {step.description}
                            </div>
                        );
                    }
                })}
            </div>
        </div>
        //     )
        // }) : null
    )
}


export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


