import type { Sample } from "./types";
import type { ComponentName } from "../definitions";

const ev = (name: string, context?: Record<string, unknown>) => ({ event: { name, ...(context ? { context } : {}) } });

export const domainSamples: Partial<Record<ComponentName, Sample>> = {
  WeatherCard: {
    components: [
      {
        id: "root",
        component: "WeatherCard",
        location: "San Francisco, CA",
        temp: 18,
        condition: "Partly cloudy",
        icon: "cloud-sun",
        high: 21,
        low: 12,
        feels: 17,
        humidity: 68,
        wind: 19,
        unit: "C",
        hourly: [
          { label: "Now", temp: 18, icon: "cloud-sun" },
          { label: "2 PM", temp: 20, icon: "sun" },
          { label: "3 PM", temp: 21, icon: "sun" },
          { label: "4 PM", temp: 20, icon: "cloud-sun" },
          { label: "5 PM", temp: 18, icon: "cloud", precip: 10 },
          { label: "6 PM", temp: 16, icon: "fog", precip: 20 },
          { label: "7 PM", temp: 15, icon: "drizzle", precip: 40 },
        ],
        daily: [
          { label: "Today", min: 12, max: 21, icon: "cloud-sun" },
          { label: "Thu", min: 11, max: 17, icon: "rain", precip: 70 },
          { label: "Fri", min: 10, max: 15, icon: "storm", precip: 85 },
          { label: "Sat", min: 11, max: 19, icon: "cloud" },
          { label: "Sun", min: 13, max: 24, icon: "sun" },
        ],
      },
    ],
  },
  ProfileCard: {
    components: [
      {
        id: "root",
        component: "ProfileCard",
        name: "Maya Chen",
        role: "Staff Engineer",
        company: "Northwind",
        avatar: "https://i.pravatar.cc/150?img=47",
        location: "Seattle, WA",
        bio: "Builds the realtime sync layer and mentors the platform team. Previously led infra at a payments startup.",
        email: "maya@northwind.dev",
        phone: "+1 206 555 0142",
        website: "https://mayachen.dev",
        tags: ["Distributed systems", "Rust", "TypeScript"],
        stats: [
          { label: "Projects", value: "24" },
          { label: "Reviews", value: "1.2k" },
          { label: "Years", value: "9" },
        ],
      },
    ],
  },
  ReceiptCard: {
    components: [
      {
        id: "root",
        component: "ReceiptCard",
        merchant: "Fieldnote Supply Co.",
        orderId: "#FN-48213",
        date: "Oct 14, 2026",
        status: "Paid",
        currency: "USD",
        items: [
          { name: "Dot grid notebook, A5", qty: 2, price: 18 },
          { name: "Brass fountain pen", qty: 1, price: 64, note: "Fine nib, engraved" },
          { name: "Ink cartridges, blue black", qty: 3, price: 6.5 },
        ],
        shipping: 0,
        discount: 10,
        tax: 9.62,
        payment: "Visa ending 4242",
      },
    ],
  },
  EventCard: {
    components: [
      {
        id: "root",
        component: "EventCard",
        title: "Agentic UI Meetup: Generative interfaces in production",
        date: "2026-11-14",
        time: "6:30 PM to 9:00 PM",
        venue: "The Foundry, 512 Market St, San Francisco",
        host: "Bay Area AI Builders",
        image: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80&auto=format&fit=crop",
        description: "Three short talks on streaming UI from agents, then demos and open floor.",
        attendees: 148,
        tags: ["In person", "Free", "Talks"],
        actionLabel: "RSVP",
        onAction: ev("rsvp", { event: "agentic-ui-meetup" }),
      },
    ],
  },
  StockTicker: {
    components: [
      {
        id: "root",
        component: "StockTicker",
        symbol: "HLVR",
        name: "Kestrel Robotics Inc.",
        price: 182.47,
        change: 3.21,
        changePct: 1.79,
        currency: "USD",
        sample: true,
        series: [176.2, 177.1, 176.4, 178.3, 177.9, 179.6, 179.1, 180.4, 179.8, 181.2, 180.6, 181.9, 182.8, 182.1, 182.47],
        stats: [
          { label: "Open", value: "179.40" },
          { label: "High", value: "183.12" },
          { label: "Low", value: "178.95" },
          { label: "Volume", value: "24.1M" },
          { label: "Mkt cap", value: "412B" },
          { label: "P/E", value: "31.4" },
        ],
      },
    ],
  },
  RecipeCard: {
    wide: true,
    components: [
      {
        id: "root",
        component: "RecipeCard",
        title: "Basil pesto farfalle with blistered tomatoes",
        image: "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=1000&q=80&auto=format&fit=crop",
        time: "25 min",
        servings: 2,
        difficulty: "Easy",
        tags: ["Vegetarian"],
        ingredients: [
          "200 g farfalle",
          "2 cups fresh basil leaves",
          "30 g pine nuts, toasted",
          "1 clove garlic",
          "40 g parmesan, grated",
          "80 ml olive oil",
          "150 g cherry tomatoes",
        ],
        steps: [
          "Cook the farfalle in well salted water until al dente. Save a cup of pasta water.",
          "Blend basil, pine nuts, garlic and parmesan, then stream in the olive oil until smooth.",
          "Blister the tomatoes in a hot pan with a little oil, about 3 minutes.",
          "Toss pasta with pesto and a splash of pasta water until glossy, then top with the tomatoes.",
        ],
      },
    ],
  },
};
