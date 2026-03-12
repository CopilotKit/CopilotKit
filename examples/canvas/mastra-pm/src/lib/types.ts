import { z } from "zod";

export const UserSchema = z.object({
  id: z.number(),
  role: z.string(),
  name: z.string(),
  email: z.string(),
  summary: z.string(),
  image: z.string(),
});

export const TaskSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["todo", "in-progress", "done"]),
  assignedTo: z.number(),
});

export const users: z.infer<typeof UserSchema>[] = [
  {
    id: 1,
    role: "Founding Engineer",
    name: "Tyler Slaton",
    email: "tyler@copilotkit.ai",
    summary: "Tyler is a software engineer at CopilotKit. He is good at building UI and connecting the dots.",
    image: "https://ui-avatars.com/api/?size=128&name=Tyler+Slaton",
  },
  {
    id: 2,
    role: "Founding Engineer",
    name: "Suhas Deshpande",
    email: "suhas@copilotkit.ai",
    summary: "Suhas is a software engineer at CopilotKit. He is good at building backend systems.",
    image: "https://ui-avatars.com/api/?size=128&name=Suhas+Deshpande",
  },
  {
    id: 3,
    role: "Product Manager",
    name: "John Rae Grant",
    email: "john@copilotkit.ai",
    summary: "John is a product manager at CopilotKit. He is able to look at the big picture and make decisions.",
    image: "https://ui-avatars.com/api/?size=128&name=John+Rae+Grant",
  },
  {
    id: 4,
    role: "Lead DevRel",
    name: "Nathan Tarbert",
    email: "nathan@copilotkit.ai",
    summary: "Nathan is a lead devrel at CopilotKit. He is able to connect with users and help them get the most out of the product.",
    image: "https://ui-avatars.com/api/?size=128&name=Nathan+Tarbert",
  },
];

export const tasks: z.infer<typeof TaskSchema>[] = [
  {
    id: 1,
    name: "Build the product",
    description: "Build the product",
    status: "in-progress",
    assignedTo: 1,
  },
];