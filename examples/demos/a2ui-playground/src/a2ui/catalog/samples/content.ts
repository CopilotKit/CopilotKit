import type { ComponentName } from "../definitions";
import type { Sample } from "./types";

export const contentSamples: Partial<Record<ComponentName, Sample>> = {
  Heading: {
    components: [
      {
        id: "root",
        component: "Heading",
        eyebrow: "Trip plan",
        text: "Three days in Tokyo",
        subtitle:
          "Food markets, quiet temples and one very late night in Shinjuku.",
      },
    ],
  },
  CodeBlock: {
    components: [
      {
        id: "root",
        component: "CodeBlock",
        filename: "catalog.ts",
        language: "ts",
        code: "export const playgroundUI = createGenerativeUI({\n  id: CATALOG_ID,\n  extends: [standardUI],\n  components,\n});",
      },
    ],
  },
  Quote: {
    components: [
      {
        id: "root",
        component: "Quote",
        text: "The best interface is the one that shows up already filled in.",
        author: "Maya Chen",
        role: "Head of Design, Lattice",
      },
    ],
  },
  ImageGallery: {
    components: [
      {
        id: "root",
        component: "ImageGallery",
        columns: 3,
        images: [
          {
            url: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80",
            caption: "Shibuya",
          },
          {
            url: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=600&q=80",
            caption: "Shinjuku",
          },
          {
            url: "https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=600&q=80",
            caption: "Akihabara",
          },
          {
            url: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&q=80",
            caption: "Kyoto",
          },
          {
            url: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=600&q=80",
            caption: "Golden Gai",
          },
          {
            url: "https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?w=600&q=80",
            caption: "Tokyo Tower",
          },
        ],
      },
    ],
  },
  VideoEmbed: {
    components: [
      {
        id: "root",
        component: "VideoEmbed",
        url: "https://www.youtube.com/watch?v=aircAruvnKk",
        title: "But what is a neural network? 3Blue1Brown",
      },
    ],
  },
  Kbd: {
    components: [
      {
        id: "root",
        component: "Kbd",
        keys: ["Cmd", "K"],
        label: "Open the command palette",
      },
    ],
  },
};
