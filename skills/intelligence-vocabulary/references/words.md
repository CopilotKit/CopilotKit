# Intelligence words

Use the word in the **Use** column for customer-facing prose, headings, nav titles, button labels, and image alt text. Do not use the **Stop** column for that concept.

| Concept                                      | Use                                                                       | Stop                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| The product                                  | CopilotKit Intelligence. After the first mention on a page, Intelligence. | Ops platform. Enterprise Intelligence as a name for the product. |
| The deployment CopilotKit runs               | Cloud-hosted                                                              | managed, hosted, or Ops platform as that deployment's name       |
| The deployment the customer runs             | Self-hosted                                                               | A second product name for the same deployment                    |
| The verb for that work                       | Self-host                                                                 |                                                                  |
| The saved-conversation feature               | Rich Threads. One record is a thread.                                     | Threads as the feature name, durable threads                     |
| Facts about a person that outlive one thread | User Memory. In titles, nav, and cards: User Memories.                    | Memories alone as the feature name                               |
| A memory for one person                      | User memory                                                               |                                                                  |
| A memory shared by the project               | Project memory                                                            |                                                                  |
| The feature that turns usage into skills     | Automatic Learning                                                        | Learning alone as the feature name                               |
| The artifact Learning publishes              | Skill                                                                     | Learned skill                                                    |
| Getting a skill to the agent                 | Skill delivery                                                            | Automatic skill delivery, automatic learned skill delivery       |
| Usage data in the product                    | Product Analytics                                                         | Analytics alone as the feature name                              |
| Messaging surfaces                           | Channels                                                                  | Messaging Channels                                               |
| Chat UI with no prebuilt components          | Headless UI                                                               | Fully Headless UI, Fully Headless Chat UI                        |
| The plan for large customers                 | Enterprise                                                                | Enterprise Intelligence, Enterprise Intelligence tier            |
| The open-source runtime                      | Open source                                                               | OSS in prose                                                     |
| The page that compares the two               | Open source vs Intelligence                                               | OSS vs Enterprise                                                |

Plan names stay as they are in the product: Developer, Team, Team Self-hosted, Enterprise.

Slack is available on cloud-hosted Intelligence. Teams is in controlled availability. Do not call either connection "managed".

## Labels and image paths

| Surface          | Use                                                                                                                                                                                                                                                                                        | Stop                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Signup button    | Start cloud-hosted setup                                                                                                                                                                                                                                                                   | Start managed onboarding                                |
| Image folder     | `/images/cloud-hosted/`                                                                                                                                                                                                                                                                    | `/images/enterprise-intelligence/`                      |
| Image file names | `cloud-hosted-ready.png`, `cloud-hosted-projects.png`, `cloud-hosted-thread-list.png`, `cloud-hosted-thread-detail.png`, `cloud-hosted-api-keys.png`, `cloud-hosted-plans.png`, `cloud-hosted-product-analytics.png`, `cloud-hosted-skill-delivery.png`, `cloud-hosted-channels-slack.png` | `managed-ready.png` and the other `managed-*.png` files |

The React component `OpsPlatformCTA` keeps its code name. Only the visible label changes.

## Leave these out of customer docs

Say what the customer does and what the customer sees.

- Do not name Clerk.
- Do not name the rollout cutoff.
- Do not say which automatic plan assignment does not count.
- Do say: sign in, accept the agreement, then choose Developer or a paid plan.

## One home for each fact

A page that is not the home links to the home. It does not explain the fact again.

| Fact                                                        | Home                        |
| ----------------------------------------------------------- | --------------------------- |
| What Intelligence is                                        | Overview                    |
| Connect an app until Inspector shows Intelligence connected | Quickstart                  |
| How to build the thread UI                                  | Rich Threads                |
| How a thread is saved and replayed                          | Rich Threads, one page      |
| User Memory                                                 | User Memories               |
| Automatic Learning                                          | Automatic Learning          |
| Skill delivery                                              | Skill delivery              |
| Product Analytics                                           | Product Analytics           |
| Channels                                                    | Channels                    |
| Headless UI                                                 | Headless UI                 |
| Organizations, projects, and keys                           | Cloud-hosted                |
| Plans and limits                                            | Plans                       |
| Open one thread in the cloud-hosted project                 | Cloud-hosted                |
| Cloud-hosted vs self-hosted                                 | Architecture                |
| Install on Kubernetes                                       | Self-host on Kubernetes     |
| Install on ECS                                              | Self-host on ECS            |
| Inspector states for Intelligence                           | Inspector                   |
| CLI login and project select                                | CLI                         |
| Open source vs Intelligence                                 | Open source vs Intelligence |

## Keep these unchanged

A Stop word inside one of these is not a docs bug. Do not rename it.

- Code identifiers and component names, including `OpsPlatformCTA` and `RichThreadsSetupPrompt`.
- Env vars and API fields, including `CPK_INTELLIGENCE_API_KEY` and `clerkOrgId`.
- Route slugs, including `oss-vs-enterprise`. The visible title and in-prose link text are still "Open source vs Intelligence".
- File paths.
- Ticket ids such as `OSS-881`.
- Channel connection mode: managed setup, managed Channel.
- ECS rollout, when it means capacity.
- AWS customer-managed, chart-managed, Route53 hosted zones, and hosted provider for embeddings.
- The words cloud-hosted and self-hosted. Both contain "hosted" and are the approved names.
