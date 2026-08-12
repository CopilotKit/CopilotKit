import type { Metadata } from "next";
import { publicAeoContract } from "@/lib/public-aeo-contract";

export const metadata: Metadata = {
  title: "Public AEO surface contract | CopilotKit Docs",
  description:
    "Technical ownership, compatibility, and verification contract for CopilotKit public machine-readable surfaces.",
  alternates: { canonical: publicAeoContract.policyUrl },
  openGraph: {
    title: "Public AEO surface contract",
    description:
      "Technical ownership, compatibility, and verification contract for CopilotKit public machine-readable surfaces.",
    url: publicAeoContract.policyUrl,
    type: "article",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: "Public AEO surface contract",
  url: publicAeoContract.policyUrl,
  mainEntityOfPage: publicAeoContract.capabilitiesUrl,
  version: String(publicAeoContract.schemaVersion),
};

export default function AeoPolicyPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 text-fd-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c"),
        }}
      />
      <header className="mb-12 border-b border-fd-border pb-8">
        <p className="mb-3 text-sm font-medium text-fd-muted-foreground">
          Technical policy · schema v{publicAeoContract.schemaVersion}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Public AEO surface contract
        </h1>
        <p className="mt-4 max-w-3xl text-fd-muted-foreground">
          This page is the human-readable view of the versioned contract used
          for public website, documentation, and documentation MCP discovery
          surfaces. The JSON artifact is the single source for both views.
        </p>
        <p className="mt-4 text-sm">
          <a
            className="underline underline-offset-4"
            href={publicAeoContract.capabilitiesUrl}
          >
            Machine-readable v{publicAeoContract.schemaVersion} contract
          </a>
        </p>
      </header>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">Canonical hosts</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {Object.entries(publicAeoContract.canonicalHosts).map(
            ([name, origin]) => (
              <div
                key={name}
                className="rounded-lg border border-fd-border p-4"
              >
                <dt className="text-sm font-medium capitalize">{name}</dt>
                <dd className="mt-1 break-all text-sm text-fd-muted-foreground">
                  {origin}
                </dd>
              </div>
            ),
          )}
        </dl>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">
          Standards and ecosystem conventions
        </h2>
        <div className="space-y-4">
          {publicAeoContract.classifications.map((classification) => (
            <article
              key={classification.id}
              className="rounded-lg border border-fd-border p-4"
            >
              <h3 className="font-semibold">{classification.label}</h3>
              <p className="mt-1 text-sm text-fd-muted-foreground">
                {classification.definition}
              </p>
              {classification.sourceUrls.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {classification.sourceUrls.map((url) => (
                    <li key={url}>
                      <a className="underline underline-offset-4" href={url}>
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">
          Compatibility and cadence
        </h2>
        <dl className="space-y-4">
          {Object.entries(publicAeoContract.compatibility).map(
            ([name, value]) => (
              <div key={name}>
                <dt className="font-medium">{name}</dt>
                <dd className="text-sm text-fd-muted-foreground">{value}</dd>
              </div>
            ),
          )}
        </dl>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">Response semantics</h2>
        <dl className="space-y-4">
          {Object.entries(publicAeoContract.responseSemantics).map(
            ([name, value]) => (
              <div key={name}>
                <dt className="font-medium">{name}</dt>
                <dd className="text-sm text-fd-muted-foreground">
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ),
          )}
        </dl>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">Owners</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {publicAeoContract.owners.map((owner) => (
            <article
              key={owner.id}
              className="rounded-lg border border-fd-border p-4"
            >
              <h3 className="font-semibold">{owner.name}</h3>
              <p className="mt-1 text-sm text-fd-muted-foreground">
                {owner.repository} · {owner.scope}
              </p>
              <p className="mt-2 text-sm">{owner.cadence}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold">
          Ownership and enforcement
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-fd-border">
                <th className="p-3">Surface</th>
                <th className="p-3">Endpoint</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Verification</th>
              </tr>
            </thead>
            <tbody>
              {publicAeoContract.surfaces.map((surface) => (
                <tr key={surface.id} className="border-b border-fd-border">
                  <td className="p-3 align-top font-medium">{surface.id}</td>
                  <td className="p-3 align-top">
                    {
                      publicAeoContract.canonicalHosts[
                        surface.host as keyof typeof publicAeoContract.canonicalHosts
                      ]
                    }
                    {surface.path}
                    <div className="mt-1 text-fd-muted-foreground">
                      {surface.contentTypes.join(", ")}
                    </div>
                  </td>
                  <td className="p-3 align-top">{surface.owner}</td>
                  <td className="p-3 align-top">
                    {surface.enforcement.mode === "automated"
                      ? surface.enforcement.command
                      : `${surface.enforcement.manualOwner}: ${surface.enforcement.followUp}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Review checklist</h2>
        <ul className="list-disc space-y-2 pl-5">
          {publicAeoContract.reviewChecklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
