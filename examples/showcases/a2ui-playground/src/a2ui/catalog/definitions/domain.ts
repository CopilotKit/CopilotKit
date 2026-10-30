import { z } from "zod";
import { def, onAction } from "./shared";

export const domainDefinitions = {
  WeatherCard: def(
    "Domain",
    "Current weather hero with condition icon, temp, high/low, details, an hourly strip and daily forecast. icon: sun|cloud-sun|cloud|fog|drizzle|rain|snow|storm.",
    z.object({
      location: z.string(),
      temp: z.number(),
      condition: z.string(),
      icon: z.string().optional(),
      high: z.number().optional(),
      low: z.number().optional(),
      feels: z.number().optional(),
      humidity: z.number().optional(),
      wind: z.number().optional(),
      unit: z.enum(["C", "F"]).optional(),
      hourly: z.array(z.object({ label: z.string(), temp: z.number(), icon: z.string().optional(), precip: z.number().optional() })).optional(),
      daily: z.array(z.object({ label: z.string(), min: z.number(), max: z.number(), icon: z.string().optional(), precip: z.number().optional() })).optional(),
    }),
  ),
  ProfileCard: def("Domain", "Person card: avatar, name, role, company, location, bio, contacts, tags, stats. Use for team members, speakers, candidates.", z.object({ name: z.string(), role: z.string().optional(), company: z.string().optional(), avatar: z.string().optional(), location: z.string().optional(), bio: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), website: z.string().optional(), tags: z.array(z.string()).optional(), stats: z.array(z.object({ label: z.string(), value: z.string() })).optional() })),
  ReceiptCard: def("Domain", "Order receipt: merchant, order id, date, line items with qty and price, subtotal/tax/total, status.", z.object({ merchant: z.string(), orderId: z.string().optional(), date: z.string().optional(), status: z.string().optional(), items: z.array(z.object({ name: z.string(), qty: z.number().optional(), price: z.number(), note: z.string().optional() })), currency: z.string().optional(), tax: z.number().optional(), shipping: z.number().optional(), discount: z.number().optional(), payment: z.string().optional() })),
  EventCard: def("Domain", "Event: date block, title, time, venue, host, attendees count, tags, RSVP action. Lead an event or conference with it.", z.object({ title: z.string(), date: z.string(), time: z.string().optional(), venue: z.string().optional(), host: z.string().optional(), description: z.string().optional(), attendees: z.number().optional(), image: z.string().optional(), tags: z.array(z.string()).optional(), actionLabel: z.string().optional() }), onAction("Fires when the RSVP button is clicked.")),
  StockTicker: def("Domain", "Stock quote header: symbol, name, price, change and % change, sparkline, key stats. sample:true labels illustrative data.", z.object({ symbol: z.string(), name: z.string().optional(), price: z.number(), change: z.number().optional(), changePct: z.number().optional(), currency: z.string().optional(), series: z.array(z.number()).optional(), stats: z.array(z.object({ label: z.string(), value: z.string() })).optional(), sample: z.boolean().optional() })),
  RecipeCard: def("Domain", "Recipe: title, time/servings/difficulty, ingredient checklist and numbered steps. Use for any recipe or cooking how-to.", z.object({ title: z.string(), image: z.string().optional(), time: z.string().optional(), servings: z.number().optional(), difficulty: z.string().optional(), ingredients: z.array(z.string()), steps: z.array(z.string()), tags: z.array(z.string()).optional() })),
};
