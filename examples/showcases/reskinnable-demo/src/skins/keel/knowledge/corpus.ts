/**
 * The Keel knowledge corpus — Harbor Point Health's policy library.
 * SERVER-SAFE: imported by both the server-side agent tool
 * (agent.ts → knowledge/search.ts) and the client Knowledge pages, so it must
 * never import React or any .tsx module.
 *
 * Document/section ids, refs, titles, and owners are FIXED by spec §5.1 — three
 * separate units (this corpus, the run-engine seed's policyRefs, and the agent
 * prompt) reference these, so any drift breaks the citation chain.
 */
import type { KnowledgeDoc, KnowledgeSpace } from "./types";

export interface KnowledgeSpaceInfo {
  id: KnowledgeSpace;
  label: string;
  description: string;
}

/** The three top-level spaces, with the display labels + blurbs the Knowledge pages render. */
export const KEEL_SPACES: KnowledgeSpaceInfo[] = [
  {
    id: "privacy",
    label: "Privacy & Security",
    description: "PHI access, breach response, and data classification.",
  },
  {
    id: "clinical",
    label: "Clinical Operations",
    description: "Credentialing, adverse events, and infection prevention.",
  },
  {
    id: "vendor",
    label: "Vendor & Procurement",
    description:
      "Business associate agreements, third-party risk, and spend authority.",
  },
];

export const KEEL_CORPUS: KnowledgeDoc[] = [
  // ── Privacy & Security ──────────────────────────────────────────────
  {
    id: "phi-access-policy",
    space: "privacy",
    title: "PHI Access & Minimum Necessary Standard",
    ref: "POL-114",
    owner: "Privacy Office",
    updated: "2026-03-14",
    sections: [
      {
        id: "scope",
        heading: "Scope & Applicability",
        body: "This policy governs all access to protected health information (PHI) held by Harbor Point Health across its nine hospitals and affiliated clinics. It applies to every workforce member — employees, medical staff, students, volunteers, and contractors — and to any system, application, or report that stores or displays PHI. Access is granted on a role-based, least-privilege basis and is never a function of seniority alone. Managers requesting access on behalf of staff are accountable for the accuracy of the request. Questions of interpretation are resolved by the Privacy Office, which owns this policy and reviews it annually. Violations are handled under POL-121 and the workforce sanctions schedule.",
      },
      {
        id: "minimum-necessary",
        heading: "Minimum Necessary Standard",
        body: "Workforce members may access only the minimum PHI necessary to perform their assigned duties. When a contractor or vendor requires patient records, the Privacy Officer determines the narrowest data scope, duration, and system set that satisfies the business purpose, and documents that determination before access is provisioned. Bulk or system-wide access requires a written minimum-necessary justification approved by the Privacy Officer. Treatment relationships are exempt from the minimum-necessary limit for the purpose of direct patient care, but not for research, operations, or billing. The standard is re-evaluated whenever a role changes. Access exceeding documented scope is a reportable privacy incident under POL-121.",
      },
      {
        id: "workforce-clearance",
        heading: "Workforce Clearance",
        body: "Before any PHI access is granted, Human Resources verifies the individual's identity and active engagement record, and Compliance confirms completion of HIPAA privacy training within the prior twelve months. Clearance is valid for the duration of the engagement and lapses automatically at its recorded end date. For contractors, the sponsoring department must attach a signed confidentiality acknowledgment and the engagement's end date to the access request. No provisional or temporary clearance may bypass training verification. The Privacy Office audits a five-percent sample of new clearances each month, and any clearance granted without documented training is revoked immediately pending remediation.",
      },
      {
        id: "contractor-access",
        heading: "Contractor & Vendor Access",
        body: "Contractors and third-party vendors receive PHI access only after a Business Associate Agreement is confirmed on file under POL-302 and a minimum-necessary scope has been set by the Privacy Officer. Contractor accounts carry a hard expiration matching the engagement end date and are limited to named individuals — shared or generic vendor logins are prohibited. Every contractor with standing access is enrolled in quarterly access-audit review. A vendor requiring access across multiple departments needs a separate scope determination per department, not a blanket grant. Radiology, laboratory, and revenue-cycle vendors are the most common contractor cases and follow the same clearance sequence as employed staff.",
      },
      {
        id: "audit-logging",
        heading: "Access Audit Logging",
        body: "Every read, write, and export of PHI is written to an immutable access log capturing user, patient, timestamp, system, and action. Logs are retained for six years to match the HIPAA documentation requirement. The Privacy Office reviews high-risk access patterns weekly — same-surname lookups, VIP records, terminated-employee activity, and after-hours bulk exports — and investigates anomalies within five business days. Contractors and standing-access accounts are subject to enhanced quarterly review. Access logs may not be altered or deleted by any workforce member, including administrators; tamper attempts are themselves reportable incidents. Managers may request an access report for their own staff through the Privacy Office.",
      },
      {
        id: "revocation",
        heading: "Access Revocation & Offboarding",
        body: "Access is revoked on the earlier of engagement end, role change, or a documented privacy violation. Human Resources and IT Identity coordinate same-day deprovisioning for terminations; for contractors, access ends automatically at the recorded engagement end date without further action. Voluntary departures are deprovisioned by end of the final shift, and involuntary terminations are deprovisioned before notification where feasible. A role change triggers a fresh minimum-necessary determination, and any access no longer justified is removed rather than carried forward. The Privacy Office reconciles active accounts against the HR roster monthly and revokes orphaned accounts. Emergency revocation may be requested by any manager or the Privacy Officer.",
      },
    ],
  },
  {
    id: "breach-response",
    space: "privacy",
    title: "Privacy Incident & Breach Response",
    ref: "POL-121",
    owner: "Privacy Office",
    updated: "2025-11-02",
    sections: [
      {
        id: "definitions",
        heading: "Definitions",
        body: "A privacy incident is any suspected or actual acquisition, access, use, or disclosure of protected health information not permitted under HIPAA. A breach is a privacy incident that compromises the security or privacy of PHI, presumed unless a four-factor risk assessment demonstrates a low probability of compromise. The four factors are the nature and extent of the PHI, the unauthorized recipient, whether the PHI was actually acquired or viewed, and the extent of risk mitigation. Discovery is the first day the incident is known, or by exercising reasonable diligence would have been known, to any workforce member other than the person who caused it.",
      },
      {
        id: "discovery-and-triage",
        heading: "Discovery & Triage",
        body: "Any workforce member who suspects a privacy incident must report it to the Privacy Office within one hour of discovery through the incident hotline or the online form. The Privacy Office opens a case, assigns a triage severity, and begins containment immediately — disabling accounts, recalling misdirected communications, or isolating affected systems. Information Security is engaged for any incident involving electronic PHI or a suspected system intrusion. A preliminary four-factor risk assessment is completed within seventy-two hours to classify the incident as a breach or a non-breach privacy event. The Chief Privacy Officer chairs the incident review and owns the breach determination.",
      },
      {
        id: "sixty-day-notification",
        heading: "Sixty-Day Notification Rule",
        body: "When an incident is determined to be a breach, Harbor Point Health notifies affected individuals without unreasonable delay and no later than sixty calendar days after discovery. Notification letters describe the PHI involved, the steps individuals should take, and the organization's mitigation. Breaches affecting five hundred or more residents of a state additionally require notice to the Secretary of Health and Human Services and prominent media within the same sixty-day window. Breaches affecting fewer than five hundred individuals are logged and reported to HHS annually within sixty days of year-end. The sixty-day clock runs from discovery, not from completion of the investigation.",
      },
      {
        id: "documentation",
        heading: "Documentation & Recordkeeping",
        body: "Every privacy incident, whether or not it rises to a breach, is documented in the incident register and retained for six years. The record includes the discovery date, four-factor risk assessment, containment actions, notification decision and dates, and the responsible investigator. Risk assessments concluding no breach must state the reasoning against each of the four factors; a conclusory statement is insufficient. The documentation is the organization's evidence of HIPAA compliance in an Office for Civil Rights audit, so completeness is treated as a control, not paperwork. The Privacy Office reviews the register quarterly for pattern trends and reports aggregate metrics to the Compliance Committee.",
      },
      {
        id: "sanctions",
        heading: "Sanctions for Violations",
        body: "Workforce members who violate this policy are subject to sanctions proportionate to the violation, applied consistently under the HR corrective-action schedule. Inadvertent, low-risk violations typically warrant retraining; deliberate snooping into records without a treatment, payment, or operations purpose warrants termination and may be reported to licensing boards and law enforcement. Sanctions are documented and retained for six years. No workforce member may be retaliated against for reporting a suspected violation in good faith. The Privacy Officer recommends sanctions and Human Resources administers them; the Chief Compliance Officer reviews any sanction involving a member of the medical staff or leadership.",
      },
    ],
  },
  {
    id: "data-classification",
    space: "privacy",
    title: "Data Classification Standard",
    ref: "STD-031",
    owner: "Information Security",
    updated: "2026-01-20",
    sections: [
      {
        id: "tiers",
        heading: "Classification Tiers",
        body: "Harbor Point Health classifies all information into four tiers: Public, Internal, Confidential, and Restricted. Public information may be freely disclosed. Internal information is for workforce use and includes routine operational data. Confidential information includes business-sensitive material whose disclosure would cause moderate harm. Restricted is the highest tier and includes all protected health information, Social Security numbers, payment card data, and credentials. Every system and dataset is assigned a tier by its data owner at creation and re-reviewed annually. When a dataset mixes tiers, the highest applicable tier governs the entire dataset. Tier drives the handling, storage, encryption, and access-review requirements defined in the sections that follow.",
      },
      {
        id: "phi-definition",
        heading: "Protected Health Information Defined",
        body: "Protected health information is individually identifiable health information that relates to a person's physical or mental health, the provision of care, or payment for care, held or transmitted in any form. Identifiers include name, dates more specific than year, geographic subdivisions smaller than a state, contact details, medical record and account numbers, biometric identifiers, and full-face images — the eighteen HIPAA identifiers. Health information stripped of all eighteen identifiers under the Safe Harbor method is no longer PHI. PHI is always classified Restricted under this standard. When in doubt whether a data element is PHI, workforce members treat it as PHI until the Privacy Office rules otherwise.",
      },
      {
        id: "handling-by-tier",
        heading: "Handling Requirements by Tier",
        body: "Restricted data, including all PHI, must be encrypted at rest and in transit, accessed only over managed devices, and never sent to personal email or consumer cloud storage. Confidential data requires encryption in transit and access limited to a defined business group. Internal data may move freely inside the network but not outside it. Printing Restricted data requires a business need and secure disposal by cross-cut shredding. Screen-sharing or presenting Restricted data requires masking of identifiers not essential to the discussion. Downloading Restricted data to removable media requires Information Security approval and hardware encryption. Each tier's requirements are cumulative with the tiers below it.",
      },
      {
        id: "deidentification",
        heading: "De-Identification",
        body: "Data may be de-identified for research, analytics, or vendor evaluation by either the Safe Harbor method — removing all eighteen identifiers — or the Expert Determination method, in which a qualified statistician certifies a very small re-identification risk. De-identified data falls out of the Restricted tier and out of HIPAA's scope, but the mapping key, if retained, remains Restricted PHI and must be stored separately under access control. A limited data set, which retains dates and geography, is not de-identified and still requires a data use agreement. Information Security and the Privacy Office jointly approve any de-identification method before a dataset leaves its source system.",
      },
      {
        id: "storage-locations",
        heading: "Approved Storage Locations",
        body: "PHI and other Restricted data may reside only in Information Security-approved locations: the enterprise EHR, the managed data warehouse, sanctioned enterprise cloud tenancies with a signed Business Associate Agreement, and encrypted managed endpoints. Personal drives, consumer file-sharing, unmanaged laptops, and unsanctioned SaaS tools are prohibited for any Restricted data. A current inventory of approved storage locations is maintained by Information Security and reviewed quarterly. Introducing a new storage location for Restricted data requires a third-party security risk assessment under STD-045 and, for external services, a BAA under POL-302. Shadow-IT storage discovered in audit is remediated within ten business days.",
      },
    ],
  },
  // ── Clinical Operations ─────────────────────────────────────────────
  {
    id: "credentialing-standard",
    space: "clinical",
    title: "Practitioner Credentialing & Privileging",
    ref: "POL-203",
    owner: "Medical Staff Office",
    updated: "2025-09-30",
    sections: [
      {
        id: "primary-source-verification",
        heading: "Primary Source Verification",
        body: "Every practitioner applying for medical staff membership or clinical privileges undergoes primary source verification of education, training, board certification, and work history. Verification is obtained directly from the issuing source — the medical school, residency program, certifying board, or the Federation of State Medical Boards — never from copies supplied by the applicant. The Medical Staff Office documents the date, source, and method of each verification. Gaps in work history exceeding thirty days are investigated and explained in writing. Verification is completed before the Credentials Committee reviews the file. Time-sensitive elements such as licensure and the National Practitioner Data Bank query are dated within one hundred twenty days of the committee decision.",
      },
      {
        id: "license-and-dea",
        heading: "License & DEA Registration",
        body: "The applicant must hold an active, unrestricted state medical license and, where the practitioner prescribes controlled substances, a current federal DEA registration and any state controlled-substance registration. The Medical Staff Office verifies each license against the issuing board's primary source and screens the practitioner against the OIG exclusion list, the System for Award Management, and state Medicaid sanction lists. Any license restriction, probation, or prior disciplinary action triggers escalation to the Credentials Committee and Medical Staff leadership. Licenses and DEA registrations are tracked to their expiration dates, and privileges are automatically suspended if a required credential lapses. Locum and telehealth practitioners are held to the same licensure standard in every state where they treat patients.",
      },
      {
        id: "malpractice-history",
        heading: "Malpractice History Review",
        body: "Risk Management reviews the applicant's malpractice claims history, including settlements, judgments, and pending actions, drawn from the National Practitioner Data Bank and the applicant's disclosure. A pattern of claims within a specialty, or any single claim involving egregious harm, is summarized for the Credentials Committee with a peer assessment of clinical relevance. The number of claims alone is not disqualifying; the committee weighs frequency against specialty norms, severity, and the practitioner's response. Current professional liability coverage meeting the organization's minimum limits must be confirmed before privileges are granted. Discrepancies between disclosed and verified claims history are treated as a professionalism concern and investigated independently.",
      },
      {
        id: "committee-review",
        heading: "Credentials Committee Review",
        body: "The Credentials Committee reviews each completed file and recommends approval, deferral, or denial to the Medical Executive Committee and the Board, which holds final authority. The committee evaluates verified qualifications, malpractice history, references, health attestation, and requested privileges against delineation criteria for the specialty. Privileges are granted specific to demonstrated competence, not by title. A practitioner may not vote on their own file, and conflicts of interest are recorded. Adverse recommendations invoke the practitioner's fair-hearing rights under the medical staff bylaws. The committee meets monthly; files requiring more information are deferred rather than approved conditionally. The Chief Medical Officer chairs the committee and signs each recommendation.",
      },
      {
        id: "provisional-privileges",
        heading: "Provisional Privileges",
        body: "A newly credentialed practitioner receives provisional privileges for an initial period, typically the first several months of practice, during which their care is subject to focused professional practice evaluation. A department-assigned proctor reviews a defined number of cases and reports findings to the department chair. Provisional status is not a lesser form of privilege but a monitoring period; unsatisfactory evaluation may lead to additional proctoring, restriction, or termination of privileges. Provisional privileges convert to full privileges only after the evaluation is complete and the department chair attests to competence. Emergency and disaster privileges are a separate, time-limited mechanism governed by the medical staff bylaws, not by this section.",
      },
      {
        id: "recredentialing-cycle",
        heading: "Recredentialing Cycle",
        body: "Every practitioner is recredentialed at least every twenty-four months. Recredentialing re-verifies licensure, DEA registration, board certification, malpractice coverage, and Data Bank status, and incorporates ongoing professional practice evaluation data — quality metrics, peer review outcomes, and any complaints — accumulated since the last cycle. A practitioner whose recredentialing is not completed before the expiration date has privileges administratively suspended until the file is current. The Medical Staff Office begins the cycle one hundred eighty days before expiration to allow time for primary source responses. Continuous monitoring of licensure sanctions and exclusion lists runs between cycles so that adverse actions are caught without waiting for the two-year review.",
      },
    ],
  },
  {
    id: "adverse-event-reporting",
    space: "clinical",
    title: "Adverse Event & Near-Miss Reporting",
    ref: "POL-208",
    owner: "Quality & Safety",
    updated: "2026-02-11",
    sections: [
      {
        id: "what-to-report",
        heading: "What to Report",
        body: "Workforce members report every adverse event, near miss, and unsafe condition through the safety event reporting system. An adverse event is harm to a patient resulting from care rather than the underlying illness; a near miss is an event that could have caused harm but did not, whether by chance or interception. Reportable events include medication errors, falls, healthcare-associated infections, procedural complications, equipment failures, and breakdowns in communication or handoff. Reporting a near miss is as important as reporting harm, because near misses reveal system weaknesses before a patient is injured. When unsure whether something qualifies, staff report it; the Quality & Safety team, not the reporter, decides relevance.",
      },
      {
        id: "timeframes",
        heading: "Reporting Timeframes",
        body: "Events are reported promptly and no later than twenty-four hours after discovery. Events involving serious harm or death — the organization's designated serious safety events — are reported immediately by phone to the Quality & Safety leader on call and to the attending physician, in addition to the written report. Sentinel events, as defined by The Joint Commission, trigger notification of the Chief Medical Officer and the Patient Safety Officer within one hour. Timely reporting preserves the ability to protect evidence, sequester equipment, and support the patient and family. The twenty-four-hour standard applies regardless of shift, weekend, or holiday; the on-call structure ensures a Quality & Safety leader is always reachable.",
      },
      {
        id: "severity-levels",
        heading: "Severity Levels",
        body: "Reported events are assigned a harm score on a standardized scale from no-harm through temporary harm, permanent harm, and death. The scale mirrors the National Coordinating Council medication-error index and is applied to all event types for consistency. Severity determines the depth of review: no-harm and near-miss events are aggregated for trend analysis, moderate-harm events receive focused review by the department, and severe-harm, permanent-harm, and death events are escalated for root cause analysis. The initial severity is assigned by the Quality & Safety reviewer within one business day and may be revised as the investigation clarifies the outcome. Severity is never assigned by the reporter.",
      },
      {
        id: "root-cause-analysis",
        heading: "Root Cause Analysis",
        body: "Serious safety events and sentinel events undergo a formal root cause analysis convened within seventy-two hours and completed within forty-five days. A multidisciplinary team, deliberately including staff not involved in the event, maps the sequence, identifies contributing factors, and distinguishes system causes from individual actions under a just-culture framework. The analysis produces an action plan with named owners, due dates, and a measurement to confirm the fix held. The Quality Director determines whether an RCA is required and the Chief Medical Officer approves the final action plan. Findings are protected under the patient safety work product privilege and are used to improve systems, not to assign blame.",
      },
      {
        id: "non-retaliation",
        heading: "Non-Retaliation",
        body: "No workforce member may be disciplined, demoted, or otherwise retaliated against for reporting a safety event in good faith, including an event involving their own error. A just-culture model distinguishes human error, which warrants consolation and system fixes, from at-risk behavior, which warrants coaching, and reckless behavior, which warrants accountability. The distinction protects honest reporting while preserving responsibility for willful disregard of safety. Retaliation against a reporter is itself a serious policy violation investigated by Human Resources and the Chief Compliance Officer. Reporters may submit events anonymously, though named reports allow follow-up. Leaders are evaluated in part on whether their units report freely.",
      },
    ],
  },
  {
    id: "infection-control",
    space: "clinical",
    title: "Infection Prevention Standard Precautions",
    ref: "POL-215",
    owner: "Infection Prevention",
    updated: "2025-12-08",
    sections: [
      {
        id: "hand-hygiene",
        heading: "Hand Hygiene",
        body: "Hand hygiene is performed at the five World Health Organization moments: before touching a patient, before a clean or aseptic procedure, after body-fluid exposure risk, after touching a patient, and after touching patient surroundings. Alcohol-based hand rub is the preferred method for routine decontamination; soap and water are required when hands are visibly soiled and after caring for a patient with a spore-forming organism such as Clostridioides difficile. Compliance is monitored by trained observers, and unit-level rates are reported monthly to the Infection Prevention Committee with a target of ninety percent or higher. Artificial nails and chipped polish are prohibited for staff with direct patient contact.",
      },
      {
        id: "ppe-by-transmission",
        heading: "PPE by Transmission Type",
        body: "Personal protective equipment is selected by transmission route. Contact precautions require gown and gloves. Droplet precautions add a surgical mask for care within six feet of the patient. Airborne precautions require a fit-tested N95 respirator or higher and a negative-pressure room. Standard precautions — treating every patient's blood and body fluids as potentially infectious — apply at all times regardless of diagnosis. PPE is donned before room entry and doffed and discarded at exit in the sequence that minimizes self-contamination, with hand hygiene performed after removal. Staff must be fit-tested annually for respirators, and units maintain a stock of all PPE sizes at each isolation room entrance.",
      },
      {
        id: "isolation-precautions",
        heading: "Isolation Precautions",
        body: "Patients with known or suspected transmissible infection are placed on the appropriate isolation precautions promptly, signaled by standardized signage at the room entrance. Multidrug-resistant organisms, C. difficile, and respiratory viruses each map to a defined precaution set in the isolation reference. Precautions are initiated empirically on clinical suspicion rather than waiting for laboratory confirmation, and are discontinued only when discontinuation criteria are met and documented. Cohorting is used when single rooms are unavailable, guided by Infection Prevention. Transport of an isolated patient is minimized and communicated ahead to the receiving area. Visitors are instructed on precautions and provided PPE at the room entrance.",
      },
      {
        id: "outbreak-escalation",
        heading: "Outbreak Escalation",
        body: "An outbreak is suspected when the incidence of an organism exceeds the expected baseline for a unit or when two or more epidemiologically linked cases are identified. The Infection Preventionist opens an investigation, notifies the hospital epidemiologist, and defines a case definition. Escalation to the Incident Command structure occurs for outbreaks threatening to overwhelm capacity or requiring unit closure. The organization notifies the local public health department for reportable conditions within the timeframe the jurisdiction requires, typically twenty-four hours for urgent conditions. Control measures — enhanced cleaning, cohorting, admission holds, and staff screening — are implemented immediately rather than after the investigation concludes. The Infection Prevention Committee reviews every outbreak after action.",
      },
    ],
  },
  // ── Vendor & Procurement ────────────────────────────────────────────
  {
    id: "baa-requirements",
    space: "vendor",
    title: "Business Associate Agreements",
    ref: "POL-302",
    owner: "Legal & Compliance",
    updated: "2026-04-01",
    sections: [
      {
        id: "when-a-baa-is-required",
        heading: "When a BAA Is Required",
        body: "A Business Associate Agreement is required before Harbor Point Health discloses protected health information to, or allows the creation or maintenance of PHI by, any external party performing a function on the organization's behalf. This includes cloud vendors, billing services, transcription, shredding companies, analytics firms, and any contractor whose work involves access to PHI. A BAA is not required for disclosures to another provider for treatment, to the patient, or where no PHI is involved. Conduit exceptions — pure transmission services such as the postal service — are narrow and confirmed by Legal, not assumed. When in doubt, the sponsoring department requests a BAA determination from Legal & Compliance before the vendor begins work.",
      },
      {
        id: "required-terms",
        heading: "Required Terms",
        body: "Every BAA must, at minimum, describe the permitted uses and disclosures of PHI, prohibit any use beyond what the agreement and law allow, require appropriate safeguards including the HIPAA Security Rule administrative, physical, and technical controls, and obligate the business associate to report security incidents and breaches to Harbor Point Health without unreasonable delay and no later than the timeframe the organization sets. The agreement must require return or destruction of PHI at termination, grant the organization audit rights, and bind the associate to make records available to the Office for Civil Rights. The organization's approved template is the starting point; vendor paper is accepted only after Legal redlines it to these minimums.",
      },
      {
        id: "subcontractor-flowdown",
        heading: "Subcontractor Flow-Down",
        body: "A business associate may not delegate a function involving PHI to a subcontractor unless it binds that subcontractor to restrictions at least as protective as those in its own BAA. This flow-down is required by the HIPAA Omnibus Rule and must be represented in the BAA the organization signs. During review, Legal confirms the vendor discloses its material subcontractors and cloud-hosting providers, because a vendor's security posture is only as strong as the subcontractors that actually hold the data. A vendor that refuses to identify subcontractors handling PHI, or refuses flow-down terms, is escalated to the Privacy Officer and Information Security and generally does not pass review. Flow-down obligations survive termination of the primary engagement.",
      },
      {
        id: "execution-and-storage",
        heading: "Execution & Storage",
        body: "A BAA is executed by an authorized signatory of each party before any PHI is shared; department staff may not sign BAAs. Fully executed agreements are stored in the contract management system and indexed to the vendor record so that access reviews and audits can confirm a current BAA is on file. The Legal & Compliance team maintains the authoritative register and flags agreements approaching renewal. Provisioning PHI access to a vendor without a stored, executed BAA is a control failure reported to the Privacy Office. The register is reconciled against the active-vendor inventory quarterly, and any vendor with PHI access but no BAA on file has access suspended pending execution.",
      },
      {
        id: "termination",
        heading: "Termination",
        body: "On termination or expiration of a BAA, the business associate must return or destroy all PHI it holds, and where return or destruction is infeasible, extend the agreement's protections to the retained PHI indefinitely and limit further use to the purpose making return infeasible. The organization obtains written certification of destruction and records it in the vendor file. IT Identity disables the vendor's access concurrently with contract end. Termination for cause is available where the associate materially breaches the agreement and fails to cure, and a breach involving PHI may trigger the incident process under POL-121. The Privacy Office confirms closure before the vendor record is retired.",
      },
    ],
  },
  {
    id: "third-party-risk",
    space: "vendor",
    title: "Third-Party Security Risk Assessment",
    ref: "STD-045",
    owner: "Information Security",
    updated: "2026-01-05",
    sections: [
      {
        id: "risk-tiering",
        heading: "Risk Tiering",
        body: "Every third-party vendor is assigned a risk tier at intake based on the sensitivity and volume of data it will handle and the criticality of the service. Tier 1 covers vendors with access to PHI or Restricted data or that are critical to clinical operations; Tier 2 covers Confidential data or important-but-recoverable services; Tier 3 covers low-sensitivity, easily replaced services. The tier sets the depth of assessment, the evidence required, and the reassessment frequency. Procurement performs the initial tiering using a standardized intake questionnaire, and Information Security confirms or adjusts it. A vendor's tier is raised whenever the scope of data or integration expands, triggering a fresh assessment before the expanded use goes live.",
      },
      {
        id: "required-evidence",
        heading: "Required Evidence",
        body: "The evidence a vendor must supply scales with its risk tier. Tier 1 vendors provide a current SOC 2 Type II report or HITRUST certification, a completed security questionnaire, evidence of encryption at rest and in transit, a documented incident response capability, and proof of cyber-liability insurance. Information Security reviews the evidence, maps findings to control gaps, and records residual risk. Where a required report is unavailable, the vendor completes the organization's full security assessment and may undergo a technical review. Third-party security review is a named approval gate: Information Security signs off before a Tier 1 vendor is approved. Evidence older than twelve months is treated as stale and re-requested.",
      },
      {
        id: "soc2-and-hitrust",
        heading: "SOC 2 & HITRUST",
        body: "A SOC 2 Type II report covering the Security and, where relevant, Confidentiality and Availability trust services criteria is the preferred assurance for Tier 1 vendors, because it reflects operating effectiveness over a period rather than a point in time. HITRUST CSF certification is accepted as equivalent and is often stronger for healthcare data. Information Security reads the report for the audit period, scope, subservice organizations, and any exceptions or qualified opinions — a clean cover page is not sufficient. Complementary user entity controls are extracted and assigned to the internal owner. A bridge letter is required when the report period ends more than three months before the review date.",
      },
      {
        id: "remediation-and-exceptions",
        heading: "Remediation & Exceptions",
        body: "When a vendor assessment surfaces a control gap, Information Security assigns a risk rating and a remediation timeline: critical findings before go-live, high findings within thirty days, and moderate findings within ninety days. A vendor unable to remediate before go-live may proceed only under a documented, time-bound risk exception approved by the Information Security Lead and the business owner, with compensating controls specified. Exceptions are logged in the risk register with an expiration date and are revisited at expiry rather than renewed automatically. Critical unmitigated findings are grounds to reject the vendor. The business owner, not Information Security, accepts residual risk, ensuring accountability sits with the party that benefits from the service.",
      },
      {
        id: "annual-review",
        heading: "Annual Review",
        body: "Tier 1 vendors are reassessed at least annually, and Tier 2 vendors every two years, to confirm evidence remains current and no new risks have emerged. The annual review re-collects the SOC 2 or HITRUST report, re-checks insurance and incident history, and confirms the BAA under POL-302 is still executed and accurate. Vendors are also screened against breach-notification feeds between reviews so that a publicly disclosed incident triggers an off-cycle assessment. A vendor that has exited the environment is offboarded — access revoked, data return or destruction certified, and the record retired. The vendor inventory and its review dates are maintained by Information Security and reported to the Risk Committee quarterly.",
      },
    ],
  },
  {
    id: "procurement-thresholds",
    space: "vendor",
    title: "Procurement Authority & Spend Thresholds",
    ref: "POL-311",
    owner: "Finance",
    updated: "2025-10-17",
    sections: [
      {
        id: "approval-matrix",
        heading: "Approval Matrix",
        body: "Purchasing authority is delegated by dollar threshold. Department managers may approve operating purchases up to twenty-five thousand dollars; directors up to one hundred thousand; vice presidents up to five hundred thousand; and the Chief Financial Officer up to two million. Commitments above two million dollars require Board Finance Committee approval. Thresholds apply to the total contract value over its term, not the first-year or monthly figure, and splitting a purchase to stay under a threshold is prohibited. Every purchase above ten thousand dollars requires a purchase order raised before the commitment. Any purchase involving PHI or vendor access additionally requires a completed third-party risk assessment under STD-045 and a BAA under POL-302 before the order is released.",
      },
      {
        id: "sole-source",
        heading: "Sole-Source Justification",
        body: "Purchases above twenty-five thousand dollars are normally competitively bid with at least three qualified suppliers. A sole-source award — selecting a single supplier without competition — requires a written justification approved one level above the normal threshold authority. Acceptable justifications include a genuinely unique capability, compatibility with an installed clinical system, a proprietary component, or a documented emergency. Preference, incumbency, or convenience is not a sole-source justification. Sole-source justifications are reviewed by Supply Chain and retained for audit, and a pattern of sole-source awards to one supplier is flagged to Internal Audit. Group purchasing organization contracts satisfy the competition requirement because the competition occurred at the GPO level.",
      },
      {
        id: "capital-vs-operating",
        heading: "Capital vs. Operating",
        body: "A purchase is capital when it acquires or improves a long-lived asset above the capitalization threshold of five thousand dollars with a useful life exceeding one year; otherwise it is an operating expense. Capital purchases are funded from the approved annual capital budget and, when unbudgeted, require a capital request through Finance regardless of the delegated operating authority. Multi-year service agreements are operating even when large. Misclassifying operating spend as capital to preserve operating budget, or the reverse, distorts financial statements and is a compliance concern. Finance makes the final classification determination when a purchase is ambiguous, and information-technology purchases that bundle hardware, software, and services are unbundled for correct treatment.",
      },
      {
        id: "emergency-purchases",
        heading: "Emergency Purchases",
        body: "An emergency purchase is permitted when a delay would endanger patient safety, disrupt essential operations, or damage property. The requester may proceed with verbal approval from the appropriate threshold authority and must document the justification and confirm a purchase order within two business days. Emergency status does not waive the third-party risk assessment or BAA requirements when the purchase involves PHI or vendor system access; those controls are completed immediately after the fact rather than skipped. Supply Chain reviews all emergency purchases monthly for pattern and appropriateness, because emergency invoked to bypass competition or planning is a misuse of the mechanism. Genuine disaster procurement follows the emergency-management plan, which supersedes routine thresholds.",
      },
    ],
  },
];

const DOCS_BY_ID = new Map(KEEL_CORPUS.map((doc) => [doc.id, doc]));

/** Resolve a document by its id, or undefined when unknown. */
export function getDoc(id: string): KnowledgeDoc | undefined {
  return DOCS_BY_ID.get(id);
}

/** All documents in a space, in corpus (authoring) order. */
export function getDocsBySpace(space: KnowledgeSpace): KnowledgeDoc[] {
  return KEEL_CORPUS.filter((doc) => doc.space === space);
}
