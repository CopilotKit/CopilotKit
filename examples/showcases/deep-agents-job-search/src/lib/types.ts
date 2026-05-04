export type Step = "idle" | "planning" | "searching" | "generating" | "done";

export type JobPosting = {
  company: string;
  title: string;
  location: string;
  url: string;
  goodMatch?: boolean;
};
