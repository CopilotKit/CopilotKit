import { DEMO_MINUTES } from "@/lib/early-access/booking";

// The booker's own words: its controls, states, and errors. The page's copy,
// and the booker's heading, note, and question, are in
// src/lib/early-access/copy.ts.

export const BOOKER_TEXT = {
  loading: "Loading open times",
  days: "Days with open times",
  timesIn: "Times in",
  timeZone: "Time zone",
  earlier: "Earlier times",
  later: "Later times",
  showing: (from: number, to: number, of: number) =>
    `Showing times ${from} to ${to} of ${of}`,
  unavailableTimeHint: "Already booked",
  /**
   * Why the time the reader picked went, then, while other times show, what
   * to do next.
   */
  notices: {
    slot_taken: {
      why: "That time was just taken.",
      next: "Pick another time.",
    },
    too_soon: {
      why: "That time is too soon to book now.",
      next: "Pick a later time.",
    },
  },
  anotherTime: "Need another time?",
  newTab: "(opens in a new tab)",
  unavailable: {
    /** The event has no open time. */
    none: "No open times to show right now",
    /** The times didn't load. */
    error: "We couldn't load the open times",
    body: "You can still book a call with the team on copilotkit.ai.",
    link: "Book on copilotkit.ai",
  },
  /** In place of the times, after a booking that may have gone through. */
  unconfirmed: {
    title: "We couldn't confirm your booking.",
    body: "Check your inbox for a calendar invite before booking again.",
    link: "Book on copilotkit.ai",
  },
  form: {
    changeTime: "Change time",
    close: "Close",
    name: "Name",
    email: "Work email",
    company: "Company",
    optional: "(optional)",
    submit: "Book this time",
    submitting: "Booking...",
    consent: "We use your details to schedule the call and follow up. See our",
    privacy: "privacy policy",
    honeypot: "Leave this field empty",
  },
  errors: {
    name: "Enter your name.",
    email: "Enter a valid email address.",
    workEmail: "Use your work email to book this demo.",
    company: "Enter your company name.",
    building: "Shorten this answer and try again.",
    timeZone:
      "We couldn't book in this time zone. Close this, then change the time zone above the times.",
    invalid: "Check your details and try again.",
    rateLimited:
      "Too many booking attempts. Wait a few minutes and try again, or book on copilotkit.ai.",
    unavailable:
      "Booking isn't available right now, and nothing was booked. Try again later, or book on copilotkit.ai.",
    unconfirmed:
      "We couldn't confirm this booking. Check your inbox for a calendar invite before booking again.",
    fallback: "Book on copilotkit.ai",
  },
  booked: {
    title: "You're booked",
    when: "When",
    length: `${DEMO_MINUTES} minutes`,
    where: "Where",
    place: "Video call",
    placeNote: "The link is in the invite.",
    with: "With",
    inviteSent: "We sent the invite to",
    reschedule: "Reschedule",
    cancel: "Cancel booking",
    done: "Done",
  },
} as const;
