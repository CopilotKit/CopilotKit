"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface V150EarlyAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function V150EarlyAccessModal({
  isOpen,
  onClose,
}: V150EarlyAccessModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    const googleFormData = new URLSearchParams({
      emailAddress: formData.get("email") as string,
      "entry.1290156474": formData.get("firstName") as string,
      "entry.1049782441": formData.get("lastName") as string,
    });

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("Submitting form data");
      }

      await fetch(
        "https://docs.google.com/forms/d/e/1FAIpQLSeEXhJ4cXv8CMU3qrUBG9AcvuBzvamkjS7IarcN5RxVhcPNPg/formResponse",
        {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: googleFormData,
        },
      );

      setSubmitted(true);

      // Close modal after 2 seconds on success
      setTimeout(() => {
        onClose();
        setSubmitted(false);
      }, 2000);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
                Get Early Access to v1.50
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Submit your name and email below to be one of the first to
                experience v1.50.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Close modal"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Video Preview */}
          <div className="mb-6 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
            <video className="w-full" controls autoPlay muted loop playsInline>
              <source
                src="https://copilotkit-public-assets.s3.us-east-1.amazonaws.com/corp-site/videos/cpk-150-v2.mp4"
                type="video/mp4"
              />
              Your browser does not support the video tag.
            </video>
          </div>

          {/* Success State */}
          {submitted ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
              <h3 className="mb-2 text-xl font-bold text-green-800 dark:text-green-300">
                Thanks for registering! 🎉
              </h3>
              <p className="text-green-700 dark:text-green-400">
                You'll be one of the first to get early access to CopilotKit
                v1.50.
              </p>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Email *
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label
                  htmlFor="firstName"
                  className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                >
                  First Name *
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  placeholder="John"
                />
              </div>

              <div>
                <label
                  htmlFor="lastName"
                  className="mb-2 block text-sm font-medium text-gray-900 dark:text-white"
                >
                  Last Name *
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  placeholder="Doe"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
              >
                {loading ? "Submitting..." : "Submit"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
