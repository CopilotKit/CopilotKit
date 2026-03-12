"use client"

import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui"
import { suggestionPrompt } from "../prompts"
import { useCoAgent, useCoAgentStateRender, useCopilotAction, useCopilotChat } from "@copilotkit/react-core"
import { useEffect, useState, useRef } from "react"
import Image from "next/image"

// Define the new interface for haiku objects (without image properties)
interface generate_haiku {
    japanese: string[];
    english: string[];
    // image_names: string[]; // Removed
    // selectedImage: string | null; // Removed
}

export const AGUI = () => {
    // Replace japanese and english state with haikus state
    // const [japanese, setJapanese] = useState<string[]>([])
    // const [english, setEnglish] = useState<string[]>([])
    const [haikus, setHaikus] = useState<generate_haiku[]>([]);
    const { visibleMessages } = useCopilotChat()
    
    // Track if haiku is accepted globally to prevent loops
    const [haikuAccepted, setHaikuAccepted] = useState(false)
    const respondedRef = useRef(false)
    
    // Add useCoAgent hook to track agent state and node
    const {
        state: agentState,
        nodeName
    } = useCoAgent<{
        document: string;
    }>({
        name: "AG_UI",
        initialState: {
            document: ""
        }
    })
    
    // Reset the responded state when the node changes to start_flow
    useEffect(() => {
        if (nodeName === "start_flow" && !haikuAccepted) {
            respondedRef.current = false;
            console.log("Reset responded state for new flow");
        }
    }, [nodeName, haikuAccepted]);
    
    useCopilotChatSuggestions({
        instructions: suggestionPrompt,
        minSuggestions: 1,
        maxSuggestions: 6,
    })

    useCoAgentStateRender({
        name: "AG_UI",
        render: ({ state }) => {
            // Don't show verification components if haiku is already accepted
            if (haikuAccepted) {
                return null;
            }
            
            if (state.tavily_response) {
                console.log("state", state.tavily_response)
                return (
                    <div className="bg-white p-6 rounded shadow-lg border text-black border-gray-200 mt-5 mb-5" key={state.tavily_response.length}>
                        <div className="space-y-4">
                            {state.tavily_response.map((item: any, index: number) => (
                                <div key={index} className="flex items-center space-x-3">
                                    <div className="w-6 h-6 flex items-center justify-center">
                                        {item.completed ? (
                                            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <div className="w-4 h-4 border-2 border-gray-300 rounded-full animate-spin border-t-black"></div>
                                        )}
                                    </div>
                                    <p className="text-gray-700">Searching internet for recent information about {item.topic}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }
            else if (state.haiku_verification) {
                console.log("haiku verification state", state.haiku_verification)
                const { steps, japanese, english } = state.haiku_verification
                
                return (
                    <div className="bg-white p-6 rounded shadow-lg border text-black border-gray-200 mt-5 mb-5" key={state.haiku_verification.steps.length}>
                        <div className="space-y-4">
                            {steps.map((step: any, index: number) => (
                                <div key={index} className="flex items-center space-x-3">
                                    <div className="w-6 h-6 flex items-center justify-center">
                                        {step.completed ? (
                                            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <div className="w-4 h-4 border-2 border-gray-300 rounded-full animate-spin border-t-black"></div>
                                        )}
                                    </div>
                                    <p className="text-gray-700">{step.task} - {step.completed ? " completed" : " in progress"} </p>
                                </div>
                            ))}
                        </div>
                        
                        <div className="mt-6" style={{ display: 'flex', gap: '2rem' }}>
                            <div>
                                {japanese && japanese.map((item: string, index: number) => (
                                    <p key={index} className="text-indigo-900">{item}</p>
                                ))}
                            </div>
                            <div>
                                {english && english.map((item: string, index: number) => (
                                    <p key={index} className="text-rose-700 italic">{item}</p>
                                ))}
                            </div>
                        </div>
                    </div>
                )
            }
            else {
                return (null)
            }
        }
    })

    useCopilotAction({
        name: "render_haiku",
        description: "Render the Confirmed haikus",
        followUp: false,
        render: ({ status, args }) => {
            console.log("Rendering haiku with args:", args, "Status:", status, "Accepted:", haikuAccepted, "Responded:", respondedRef.current)
            
            useEffect(() => {
                if (args && args.japanese && args.english) {
                    const haikuFromArgs: generate_haiku = {
                        japanese: args.japanese,
                        english: args.english,
                        // image_names: args.image_names || [], // Removed
                        // selectedImage: args.selectedImage || null, // Removed
                    };

                    setHaikus(prevHaikus => {
                        const index = prevHaikus.findIndex(h =>
                            JSON.stringify(h.japanese) === JSON.stringify(haikuFromArgs.japanese) &&
                            JSON.stringify(h.english) === JSON.stringify(haikuFromArgs.english)
                        );
                        if (index !== -1) {
                            const updatedHaikus = [...prevHaikus];
                            updatedHaikus[index] = { ...prevHaikus[index], ...haikuFromArgs };
                            return updatedHaikus;
                        } else {
                            return [...prevHaikus, haikuFromArgs];
                        }
                    });
                }
            }, [args]);

            const generatedHaikuForCard: Partial<generate_haiku> = (args && args.japanese && args.english)
                ? {
                    japanese: args.japanese,
                    english: args.english,
                }
                : { japanese: [], english: [] };

            return (
                <div className="suggestion-card bg-white text-left rounded-xl p-6 my-4 shadow-lg">
                    {generatedHaikuForCard?.japanese?.map((line, index) => (
                        <div className="flex items-baseline gap-x-3 mb-3" key={index}>
                            <p className="text-3xl font-semibold text-gray-800">{line}</p>
                            <p className="text-lg font-normal text-gray-500">
                                {generatedHaikuForCard.english?.[index]}
                            </p>
                        </div>
                    ))}
                </div>
            );
        }
    })

    // For dev purposes. Will be removed in production.
    console.log("visibleMessages", visibleMessages)

    return (
        <div className="w-screen bg-white flex flex-col overflow-hidden" style={{ height: '100vh' }}>
            {/* Logo in the top left */}
            <div className="p-8 bg-white flex items-center">
                <div className="flex items-center mr-4">
                    <Image 
                        src="/copilotkit_logo.svg" 
                        alt="CopilotKit Logo" 
                        width={180} 
                        height={60}
                    />
                </div>
                {/* <h1 className="text-2xl font-light text-gray-200">Haiku Generator</h1> */}
            </div>
            
            {/* Welcome message that disappears when there are messages */}
            {visibleMessages.length === 0 && (
                <div className="absolute top-[25%] left-0 right-0 mx-auto w-full max-w-3xl z-40 pl-10">
                    <h1 className="text-4xl font-bold text-black mb-3">Hello, I am Haiku agent!</h1>
                    <p className="text-2xl text-gray-500">I can create a haiku based on a recent news topic—just tell me the subject, and I'll turn it into poetry.</p>
                </div>
            )}
            
            <div className="flex-1 flex justify-center items-center bg-white overflow-y-auto">
                <CopilotChat className="w-full max-w-3xl flex flex-col h-full py-6" />
            </div>
        </div>
    )
}
