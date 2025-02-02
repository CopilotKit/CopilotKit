import React, { useMemo, useState } from "react";
import { CloseIcon, LifeBuoyIcon, LoadingSpinnerIcon } from "./icons";

export function CopilotKitHelpModal() {
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [issueDescription, setIssueDescription] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validateEmail = (email: string) => {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (email?.length > 0 && !validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setSubmitting(true);

    await fetch("https://api.segment.io/v1/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "oss.dev-console.help",
        anonymousId: window.crypto.randomUUID(),
        properties: { email, text: issueDescription },
        writeKey: "q0gQqvGYyw9pNyhIocNzefSYKGO1aiwW",
      }),
    });

    // Reset
    setEmailError("");
    setEmail("");
    setIssueDescription("");
    setSubmitting(false);
    setShowHelpModal(false);
  };

  const HelpButton = () => (
    <button
      onClick={() => setShowHelpModal(true)}
      style={{ width: "50px", height: "30px", marginRight: "0.25rem" }}
      className="text-sm p-0 bg-transparent rounded border border-blue-500"
      aria-label="Open Help"
    >
      Help
    </button>
  );

  const submitButtonDisabled = useMemo(
    () => submitting || !!emailError || issueDescription == null || issueDescription?.length == 0,
    [submitting, emailError, issueDescription],
  );

  return (
    <>
      <HelpButton />
      {showHelpModal && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(11, 15, 26, 0.5)", zIndex: 99 }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 flex-col relative">
            <button
              className="absolute text-gray-400 hover:text-gray-600 focus:outline-none"
              style={{ top: "10px", right: "10px" }}
              onClick={() => setShowHelpModal(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <div className="w-full flex mb-6 justify-center">
              <h2 className="text-2xl font-bold">Help Options</h2>
            </div>
            <div className="space-y-4 mb-4">
              <div className="block w-full text-center py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-150 text-sm">
                <a
                  href="https://docs.copilotkit.ai/coagents/troubleshooting/common-issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit the Troubleshooting and FAQ section in the docs
                </a>
              </div>
              <div className="block w-full text-center py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-150 text-sm">
                <a
                  href="https://go.copilotkit.ai/dev-console-support-discord"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Go to Discord Support Channel (Community Support)
                </a>
              </div>
              <div className="block w-full text-center py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-150 text-sm">
                <a
                  href="https://go.copilotkit.ai/dev-console-support-slack"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apply for Priority Direct Slack Support
                </a>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col space-y-2">
              <div>
                <label htmlFor="feedback" className="block text-sm font-medium text-gray-700 mb-1">
                  Let us know what your issue is:
                </label>
                <textarea
                  id="feedback"
                  rows={4}
                  className="w-full px-3 py-2 text-gray-700 border rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="A Loom link / screen recording is always great!"
                  onChange={(e) => setIssueDescription(e.target.value)}
                  value={issueDescription}
                  required
                ></textarea>
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email (optional):
                </label>
                <input
                  type="email"
                  id="email"
                  className={`w-full px-3 py-2 text-gray-700 border rounded-lg focus:outline-none focus:border-blue-500 ${emailError ? "border-red-500" : ""}`}
                  placeholder="Enter your email for follow-up"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  value={email}
                />
                {emailError && <p className="text-red-500 text-sm mt-1">{emailError}</p>}
              </div>
              <div className="bg-gray-50 px-4 py-4 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                <button
                  type="submit"
                  onClick={handleSubmit}
                  disabled={submitButtonDisabled}
                  style={
                    submitButtonDisabled
                      ? { backgroundColor: "rgb(216, 216, 216)", color: "rgb(129, 129, 129)" }
                      : undefined
                  }
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-500 text-base font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:shadow-none"
                >
                  {submitting ? <LoadingSpinnerIcon color="white" /> : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
