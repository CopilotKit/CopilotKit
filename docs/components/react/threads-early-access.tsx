import { InsecurePasswordProtected } from "./insecure-password-protected";

const REQUEST_ACCESS_URL = "https://go.copilotkit.ai/threads-early-access";

const splash = (
  <div className="space-y-4 text-center">
    <h3 className="text-xl font-bold">Threads is in early access</h3>
    <div className="text-base mx-auto">
      <p>
        Threads — persistent, resumable conversations powered by the CopilotKit
        Intelligence Platform — is currently available to early access
        customers.
        <a
          target="_blank"
          rel="noreferrer"
          href={REQUEST_ACCESS_URL}
          className="ml-1 underline"
        >
          Request access here.
        </a>
      </p>
      <p>
        Already an early adopter? Enter your password below — we&apos;ll
        remember it on this device.
      </p>
    </div>
  </div>
);

export function ThreadsEarlyAccess({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <InsecurePasswordProtected unauthenticatedComponent={splash}>
      {children}
    </InsecurePasswordProtected>
  );
}
