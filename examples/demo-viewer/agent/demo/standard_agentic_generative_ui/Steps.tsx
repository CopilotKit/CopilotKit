import { useState } from "react"
import { Spinner } from "./page"

export const Steps = ({ status, args, respond }: any) => {
    const [steps, setSteps] = useState(args?.steps)

    if (respond) {
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
            respond("The steps are completed successfully")
        })();
    }

    return (
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
    )
}


export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


