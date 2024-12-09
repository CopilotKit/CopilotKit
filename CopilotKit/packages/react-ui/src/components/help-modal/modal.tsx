import React, { useState } from 'react';
import { CloseIcon, LifeBuoyIcon } from "./icons";

export function CopilotKitHelpModal() {
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [issueDescription, setIssueDescription] = useState("");

    const handleSubmit = () => {
        // submit issueDescription
        setShowHelpModal(false)
    }

    const HelpButton = () => (
        <button
            onClick={() => setShowHelpModal(true)}
            className="p-2 bg-transparent rounded-full shadow-lg hover:shadow-xl transition-shadow duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Open Help"
        >
            <LifeBuoyIcon />
        </button>
    );

    return (
        <>
            <HelpButton />
            {showHelpModal && (
                <div
                    className="fixed inset-0 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(11, 15, 26, 0.5)', zIndex: 99 }}
                >
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 flex-col relative">
                        <button
                            className="absolute top-2.5 right-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
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
                            <div>
                                <label htmlFor="feedback" className="block text-sm font-medium text-gray-700 mb-1">
                                    Let us know what your issue is:
                                </label>
                                <textarea
                                    id="feedback"
                                    rows={4}
                                    className="w-full px-3 py-2 text-gray-700 border rounded-lg focus:outline-none focus:border-blue-500"
                                    placeholder="A Loom link / screen recording is always great!"
                                    onChange={e => setIssueDescription(e.target.value)}
                                    value={issueDescription}
                                ></textarea>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-500 text-base font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                            >
                                Submit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
