"use client";
import { CopilotKit, useCopilotReadable } from "@copilotkit/react-core";
import "./styles.css";
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { useState } from "react";

export default function Mail() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit/travel">
      <UI />
    </CopilotKit>
  );
}

function UI() {
  const [expandedIndex, setExpandedIndex] = useState(-1);
  const messages = [
    {
      from: "John Smith",
      to: "Jane Doe",
      subject: "Collaboration on Advanced AI Integration Project",
      body: `Dear Jane,

    I hope this email finds you well. I am excited to discuss the upcoming project between TechInnovate Solutions and NexGen Technologies regarding the advanced AI integration for your customer service platform.
    
    As per our initial meetings, the main objectives for this project are:
    
      1.	Enhancing the current AI chatbot to handle more complex queries.
      2.	Integrating AI-driven analytics to provide real-time insights.
      3.	Developing a predictive model to anticipate customer needs based on historical data.
    
    We have already started working on the preliminary designs, and I would love to get your input on the following aspects:
    
      1.	User Experience Enhancements: Are there specific features or functionalities your team has identified as crucial for improving the user experience?
      2.	Data Integration: We need access to your historical data to develop the predictive model. Could you let us know the best way to facilitate this data transfer securely?
      3.	Project Timeline: To ensure we meet your expectations, can you provide more detailed deadlines for each project phase?
    
    Looking forward to your feedback.
    
    Best regards,

    John Smith`.replace(/\s+/g, " "),
    },
    {
      from: "Jane Doe",
      to: "John Smith",
      subject: "Re: Collaboration on Advanced AI Integration Project",
      body: `Hi John,
      
      Thank you for the detailed overview. We're equally enthusiastic about this collaboration.
      
      Regarding your questions:
      
        1.	User Experience Enhancements: Our team has suggested implementing a voice recognition feature for the AI chatbot. Do you think this is feasible within our current scope?
        2.	Data Integration: We can arrange a secure FTP transfer for the historical data. I will coordinate with our IT department and provide you with the necessary credentials by the end of this week.
        3.	Project Timeline: We aim to have the user experience enhancements and data integration completed by September 30th. Could you provide a rough estimate of the time required for the development of the predictive model?
      
      Additionally, I have a few more queries:
      
        1.	Scalability: How scalable is the proposed AI solution? Can it handle an increase in user queries during peak times?
        2.	Maintenance and Support: Post-deployment, what kind of maintenance and support can we expect from TechInnovate Solutions?
        3.	Cost Estimates: Could you provide a more detailed cost estimate for each phase of the project?
      
      Looking forward to your responses.
      
      Best regards,
      
      Jane Doe`.replace(/\s+/g, " "),
    },
  ];
  useCopilotReadable({
    description: "Information about Jane Doe",
    value: {
      name: "Jane Doe",
      email: "jane.doe@nexgen.com",
      jobTitle: "Product Manager",
      companyName: "NexGen Technologies",
    },
  });

  useCopilotReadable({
    description: "Information about John Smith",
    value: {
      name: "John Smith",
      email: "john.smith@techinnovate.com",
      jobTitle: "Senior Software Engineer",
      companyName: "TechInnovate Solutions",
    },
  });

  useCopilotReadable({
    description: "Current Email thread",
    value: {
      messages,
    },
  });

  return (
    <div className="max-w-screen-lg ml-20 pt-20">
      {/* prev messages */}
      <div className="flex flex-col h-96 shadow-lg mt-10 border border-gray-200 rounded-lg">
        <div className="p-4 bg-gray-100 border-b cursor-pointer">
          {messages.map((message, index) => (
            <div
              key={index}
              className="mb-4"
              onClick={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
            >
              <p className="text-sm text-gray-700">
                <strong>{message.from}:</strong>{" "}
                {expandedIndex === index ? message.body : `${message.body.substring(0, 130)}...`}
              </p>
            </div>
          ))}
        </div>
        <header className="bg-background border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="p-2">
              To:
            </Button>
            <div className="bg-muted border-none focus:ring-0 focus:border-none">
              Jane Doe &lt;jane.doe@nexgen.com&gt;
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="p-2">
              <PaperclipIcon className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="p-2">
              <TrashIcon className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="p-2">
              <MoveHorizontalIcon className="w-5 h-5" />
            </Button>
            <Button size="sm">Send</Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <CopilotTextarea
            className="bg-transparent border-none focus:ring-0 focus:border-none focus:outline-none text-2xl font-medium w-full h-full resize-none p-4"
            autosuggestionsConfig={{
              textareaPurpose:
                "An email from John Smith to Jane Doe. Make sure to answer in context of the current email thread.",
              debounceTime: 250,
              disableWhenEmpty: true,
              chatApiConfigs: {
                suggestionsApiConfig: {
                  forwardedParams: {
                    max_tokens: 20,
                    stop: [".", "?", "!"],
                  },
                },
                insertionApiConfig: {},
              },
            }}
          />
        </div>
        <footer className="bg-background border-t px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="p-2">
              <SmileIcon className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="p-2">
              <ActivityIcon className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="p-2">
              <CalendarIcon className="w-5 h-5" />
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="p-2">
              <SaveIcon className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="p-2">
              <SendIcon className="w-5 h-5" />
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Button(props) {
  return <button {...props} />;
}

function Input(props) {
  return <input {...props} />;
}

function Textarea(props) {
  return <textarea {...props} />;
}

function ActivityIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

function ArrowLeftIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function MoveHorizontalIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="18 8 22 12 18 16" />
      <polyline points="6 8 2 12 6 16" />
      <line x1="2" x2="22" y1="12" y2="12" />
    </svg>
  );
}

function PaperclipIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SaveIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

function SendIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function SmileIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" x2="9.01" y1="9" y2="9" />
      <line x1="15" x2="15.01" y1="9" y2="9" />
    </svg>
  );
}

function TrashIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function XIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
