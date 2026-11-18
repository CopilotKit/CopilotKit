import type {
  Admin,
  Group,
  Journey,
  JourneyItem,
  Learner,
  LearnerStatus,
} from "./types";

/**
 * Myelin's seed: Harvest Lane Grocers, a fictional regional grocery chain with
 * three stores, running its frontline training on Myelin.
 *
 * Two published journeys already exist, and they are what make publishing a
 * NEW one risky: some learners sit in more than one group, so a new journey
 * aimed at one group can land on people who are mid-way through another. That
 * is the cross-group conflict the governance beat is about, and it is seeded
 * twice (Deli ↔ Bakery, Seafood ↔ Front End) so the teach-a-skill beat has a
 * fresh case to replay on after it has been taught once.
 */

/** The HR rule the audience check enforces. */
export const ONBOARDING_POLICY =
  "Harvest Lane policy: one onboarding journey at a time";

export const SEED_ADMINS: Admin[] = [
  {
    id: "adm-priya",
    name: "Priya Raman",
    initials: "PR",
    title: "L&D Program Manager",
    color: "#7c3aed",
  },
  {
    id: "adm-marcus",
    name: "Marcus Bell",
    initials: "MB",
    title: "Fresh Foods Training Lead",
    color: "#0891b2",
  },
];

export const DEFAULT_ADMIN_ID = "adm-priya";

export const SEED_GROUPS: Group[] = [
  {
    id: "g-deli-north",
    name: "Deli · Northside",
    department: "Deli",
    store: "Northside",
    learnerCount: 148,
  },
  {
    id: "g-deli-river",
    name: "Deli · Riverside",
    department: "Deli",
    store: "Riverside",
    learnerCount: 131,
  },
  {
    id: "g-deli-east",
    name: "Deli · Eastgate",
    department: "Deli",
    store: "Eastgate",
    learnerCount: 133,
  },
  {
    id: "g-bakery-north",
    name: "Bakery · Northside",
    department: "Bakery",
    store: "Northside",
    learnerCount: 96,
  },
  {
    id: "g-seafood-river",
    name: "Seafood · Riverside",
    department: "Seafood",
    store: "Riverside",
    learnerCount: 54,
  },
  {
    id: "g-seafood-east",
    name: "Seafood · Eastgate",
    department: "Seafood",
    store: "Eastgate",
    learnerCount: 47,
  },
  {
    id: "g-produce-north",
    name: "Produce · Northside",
    department: "Produce",
    store: "Northside",
    learnerCount: 120,
  },
  {
    id: "g-frontend-east",
    name: "Front End · Eastgate",
    department: "Front End",
    store: "Eastgate",
    learnerCount: 210,
  },
];

const SEED_TIME = "2026-09-21T15:00:00.000Z";

function item(
  id: string,
  title: string,
  kind: JourneyItem["kind"],
  minutes: number,
  dependsOn: string[] = [],
  delayDays = 0,
  required = true,
): JourneyItem {
  return {
    id,
    title,
    kind,
    minutes,
    dependsOn,
    delayDays,
    required,
    updatedBy: "adm-marcus",
    updatedAt: SEED_TIME,
  };
}

export const SEED_JOURNEYS: Journey[] = [
  {
    id: "j-bakery",
    name: "Bakery Essentials",
    description:
      "Onboarding for new bakery associates: ovens, allergens, and the morning bake.",
    status: "published",
    audienceGroupIds: ["g-bakery-north"],
    items: [
      item("bk-1", "Welcome to the Bakery", "video", 4),
      item("bk-2", "Allergen labelling basics", "microlesson", 5, ["bk-1"]),
      item("bk-3", "Allergen check", "quiz", 3, ["bk-2"]),
      item("bk-4", "Deck oven safety", "microlesson", 5, ["bk-1"]),
      item("bk-5", "Oven start-up walkthrough", "observation", 20, ["bk-4"], 2),
      item("bk-6", "Morning bake checklist", "checklist", 10, ["bk-3", "bk-5"]),
    ],
    audienceRules: [],
    enrollmentWindowDays: 21,
    publishedAt: "2026-09-02T14:00:00.000Z",
    updatedBy: "adm-marcus",
    updatedAt: "2026-09-02T14:00:00.000Z",
  },
  {
    id: "j-frontend",
    name: "Front End Cross-Training",
    description:
      "Cashier and self-checkout cross-training for associates who pick up front-end shifts.",
    status: "published",
    audienceGroupIds: ["g-frontend-east"],
    items: [
      item("fe-1", "Register basics", "microlesson", 5),
      item("fe-2", "Self-checkout assists", "microlesson", 4, ["fe-1"]),
      item("fe-3", "ID checks for age-restricted sales", "microlesson", 5, [
        "fe-1",
      ]),
      item("fe-4", "Age-restricted sales", "certification", 15, ["fe-3"]),
      item("fe-5", "Shadow shift", "observation", 60, ["fe-2", "fe-4"], 3),
    ],
    audienceRules: [],
    enrollmentWindowDays: 14,
    publishedAt: "2026-09-09T14:00:00.000Z",
    updatedBy: "adm-priya",
    updatedAt: "2026-09-09T14:00:00.000Z",
  },
  {
    id: "j-seafood",
    name: "Seafood Counter Onboarding",
    description:
      "New seafood counter associates: cold chain, shellfish tagging, and counter service.",
    status: "draft",
    audienceGroupIds: ["g-seafood-river", "g-seafood-east"],
    items: [
      item("sf-1", "Welcome to the counter", "video", 3),
      item("sf-2", "Cold chain: 41°F and below", "microlesson", 5, ["sf-1"]),
      item("sf-3", "Shellfish tag retention", "microlesson", 4, ["sf-2"]),
      item("sf-4", "Cold chain check", "quiz", 3, ["sf-2", "sf-3"]),
      item("sf-5", "Ice bed set-up", "observation", 25, ["sf-4"], 2),
    ],
    audienceRules: [],
    enrollmentWindowDays: null,
    publishedAt: null,
    updatedBy: "adm-marcus",
    updatedAt: "2026-09-24T16:30:00.000Z",
  },
];

const FIRST = [
  "Ana",
  "Ben",
  "Chloe",
  "Dev",
  "Elena",
  "Femi",
  "Grace",
  "Hugo",
  "Isla",
  "Jamal",
  "Keiko",
  "Luis",
  "Maya",
  "Nate",
  "Olu",
  "Paula",
  "Quinn",
  "Rosa",
  "Sam",
  "Tariq",
  "Uma",
  "Victor",
  "Wren",
  "Xavi",
  "Yara",
  "Zane",
  "Amara",
  "Bruno",
  "Cleo",
  "Dmitri",
];
const LAST = [
  "Alvarez",
  "Brooks",
  "Chen",
  "Diallo",
  "Evans",
  "Fischer",
  "Garcia",
  "Hughes",
  "Ito",
  "Jensen",
  "Kowalski",
  "Lopez",
  "Mensah",
  "Nguyen",
  "Okafor",
  "Patel",
  "Quintero",
  "Reyes",
  "Silva",
  "Tanaka",
];

/**
 * A unique name per learner: step through the 600 first×last pairs with a
 * stride coprime to 600, so neighbours differ and no pair repeats below 600.
 */
function learnerName(n: number): string {
  const idx = (n * 37) % (FIRST.length * LAST.length);
  return `${FIRST[idx % FIRST.length]} ${LAST[Math.floor(idx / FIRST.length)]}`;
}

function progressFor(n: number): {
  status: LearnerStatus;
  percent: number;
  daysOverdue: number;
} {
  const bucket = n % 10;
  if (bucket < 2)
    return {
      status: "overdue",
      percent: 20 + (n % 5) * 10,
      daysOverdue: 2 + (n % 9),
    };
  if (bucket < 6)
    return {
      status: "in-progress",
      percent: 30 + (n % 6) * 10,
      daysOverdue: 0,
    };
  if (bucket < 8) return { status: "not-started", percent: 0, daysOverdue: 0 };
  return { status: "complete", percent: 100, daysOverdue: 0 };
}

/**
 * A SAMPLE of learners, not all 939: enough to carry the two overlaps exactly
 * and to give the Learners page realistic rows. Group headcounts come from
 * `Group.learnerCount`, which is the platform's number, not this list's length.
 *
 * The overlaps are exact and load-bearing — the governance card and the agent
 * both quote them:
 *  - 38 learners in BOTH Deli · Northside and Bakery · Northside, mid-way
 *    through Bakery Essentials;
 *  - 12 learners in BOTH Seafood · Eastgate and Front End · Eastgate, mid-way
 *    through Front End Cross-Training.
 */
function buildLearners(): Learner[] {
  const learners: Learner[] = [];
  let n = 0;
  const push = (
    groupIds: string[],
    journeyIds: string[],
    forceActive = false,
  ) => {
    const progress: Learner["progress"] = {};
    for (const journeyId of journeyIds) {
      const p = progressFor(n);
      progress[journeyId] =
        forceActive && (p.status === "complete" || p.status === "not-started")
          ? {
              status: "in-progress",
              percent: 40 + (n % 5) * 10,
              daysOverdue: 0,
            }
          : p;
    }
    learners.push({
      id: `l-${String(n + 1).padStart(3, "0")}`,
      name: learnerName(n),
      groupIds,
      progress,
    });
    n += 1;
  };

  for (let i = 0; i < 38; i++)
    push(["g-deli-north", "g-bakery-north"], ["j-bakery"], true);
  for (let i = 0; i < 12; i++)
    push(["g-seafood-east", "g-frontend-east"], ["j-frontend"], true);
  for (let i = 0; i < 30; i++) push(["g-bakery-north"], ["j-bakery"]);
  for (let i = 0; i < 40; i++) push(["g-frontend-east"], ["j-frontend"]);
  for (let i = 0; i < 24; i++)
    push([["g-deli-north", "g-deli-river", "g-deli-east"][i % 3]!], []);
  for (let i = 0; i < 10; i++)
    push([i % 2 ? "g-seafood-river" : "g-seafood-east"], []);
  return learners;
}

export const SEED_LEARNERS: Learner[] = buildLearners();
