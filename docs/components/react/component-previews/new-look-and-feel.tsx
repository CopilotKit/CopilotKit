"use client"

import { CopilotChat } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

export const NewLookAndFeelPreview = () => {

    const chatStyles = "h-96 rounded-lg "
    return (
        <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_PUBLIC_API_KEY}>
            <CopilotChat
                className={chatStyles}
                onThumbsUp={(message) => {alert(message)}} 
                onThumbsDown={(message) => {alert(message)}}     
                labels={{
                    initial: "Hello, how can I help you today?"
                }}
            />
        </CopilotKit>
    )
}