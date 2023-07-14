import React from "react";
import { useState } from "react";
import { DestinationTable } from "./destination-table";

export type Destination = {
  name: string;
  country: string;
  image: string;
  description: string;
  activities: string;
};

export function VacationList() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 bg-slate-50 py-4">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-3xl font-semibold leading-6 text-gray-900">
            WaterBnB
          </h1>
        </div>
      </div>
      <div className="mt-8 flow-root bg-slate-200">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <DestinationTable
              destinations={visitedDestinations}
              heading="Visited Destinations"
            />
          </div>
        </div>
      </div>
      <div className="mt-8 flow-root bg-slate-200">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <DestinationTable
              destinations={newDestinations}
              heading="New Destinations"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const visitedDestinations: Destination[] = [
  {
    name: "New York City",
    country: "USA",
    image:
      "https://images.unsplash.com/photo-1565981848603-61f050ffdb03?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      'Known as "The Big Apple", famous for its high energy, arts scene, and iconic landmarks.',
    activities: "Visit the Statue of Liberty, Central Park, Times Square, etc.",
  },
  {
    name: "London",
    country: "United Kingdom",
    image:
      "https://images.unsplash.com/photo-1565981848603-61f050ffdb03?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "England's capital known for its rich history, art, culture, and famous landmarks.",
    activities:
      "Visit the British Museum, the Tower of London, Buckingham Palace, etc.",
  },
  {
    name: "Sydney",
    country: "Australia",
    image:
      "https://images.unsplash.com/photo-1514395462725-fc821c9f2530?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Australia's biggest city known for its harbourfront Sydney Opera House, arched Harbour Bridge and Darling Harbour.",
    activities:
      "Visit Sydney Opera House, Sydney Harbour Bridge, Bondi Beach, etc.",
  },
  {
    name: "Cairo",
    country: "Egypt",
    image:
      "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Egypt's sprawling capital, set on the Nile River, known for its ancient civilization.",
    activities:
      "Visit Pyramids of Giza, the Egyptian Museum, Khan El Khalili Bazaar, etc.",
  },
];

const newDestinations: Destination[] = [
  {
    name: "Paris",
    country: "France",
    image:
      "https://images.unsplash.com/photo-1511739001486-8g416749f7d2?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      'Known as the "City of Light", famous for its museums and architectural landmarks.',
    activities: "Visit Eiffel Tower, Louvre Museum, Notre-Dame, etc.",
  },
  {
    name: "Tokyo",
    country: "Japan",
    image:
      "https://images.unsplash.com/photo-1565981848603-61f050ffdb03?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A bustling city known for its modern architecture, nightlife, and hearty street food.",
    activities: "Visit Tokyo Tower, Meiji Shrine, Tokyo Disneyland, etc.",
  },
  {
    name: "Rome",
    country: "Italy",
    image:
      "https://images.unsplash.com/photo-1565981848603-61f050ffdb03?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "The capital of Italy known for its ancient ruins, including the Forum and the Colosseum.",
    activities: "Visit the Vatican City, Roman Forum, Colosseum, etc.",
  },
  {
    name: "Rio de Janeiro",
    country: "Brazil",
    image:
      "https://images.unsplash.com/photo-1516541196182-6e25a30c1c5e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A huge seaside city in Brazil, known for its Copacabana and Ipanema beaches, and the Christ the Redeemer statue.",
    activities:
      "Visit Sugarloaf Mountain, the Christ the Redeemer statue, Ipanema Beach, etc.",
  },
  {
    name: "Athens",
    country: "Greece",
    image:
      "https://images.unsplash.com/photo-1517839096890-d3919738b6a3?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "The capital and largest city of Greece, known for its archaeological ruins and monuments.",
    activities: "Visit Acropolis, Parthenon, Ancient Agora, etc.",
  },
  {
    name: "Istanbul",
    country: "Turkey",
    image:
      "https://images.unsplash.com/photo-1516387331515-e82be8d803a0?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A city straddling Europe and Asia across the Bosphorus Strait, known for its historic sites.",
    activities: "Visit Hagia Sophia, Blue Mosque, Topkapi Palace, etc.",
  },
  {
    name: "Bali",
    country: "Indonesia",
    image:
      "https://images.unsplash.com/photo-1513414300786-fba81e61f3e3?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "An Indonesian island known for its forested volcanic mountains, iconic rice paddies, beaches and coral reefs.",
    activities: "Visit Ubud, Seminyak, Nusa Dua, etc.",
  },
  {
    name: "Vienna",
    country: "Austria",
    image:
      "https://images.unsplash.com/photo-1564068516393-b64cb1a4d33a?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A city marked by its imperial palaces and musical heritage, located on the Danube River.",
    activities:
      "Visit Schönbrunn Palace, St. Stephen's Cathedral, Vienna State Opera, etc.",
  },
  {
    name: "Havana",
    country: "Cuba",
    image:
      "https://images.unsplash.com/photo-1506332929028-5b8db5b47324?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Cuba's capital, a city carrying the scent of the old world with its well-preserved Spanish colonial architecture.",
    activities: "Visit Old Havana, Morro Castle, Malecón, etc.",
  },
  {
    name: "Dubai",
    country: "United Arab Emirates",
    image:
      "https://images.unsplash.com/photo-1512453979798-5ea266f88848?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A city known for its modern architecture, luxury shopping, and a lively nightlife scene.",
    activities: "Visit Burj Khalifa, Dubai Mall, Palm Jumeirah, etc.",
  },
  {
    name: "Edinburgh",
    country: "Scotland",
    image:
      "https://images.unsplash.com/photo-1564584217132-2271feaeb3c5?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Scotland's compact, hilly capital known for its historical sites.",
    activities: "Visit Edinburgh Castle, Arthur's Seat, Royal Mile, etc.",
  },
  {
    name: "Marrakesh",
    country: "Morocco",
    image:
      "https://images.unsplash.com/photo-1565372039055-e2c6a4e75747?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A city steeped in rich history and culture, known for its palaces and gardens.",
    activities: "Visit Jardin Majorelle, Koutoubia Mosque, Bahia Palace, etc.",
  },
  {
    name: "Prague",
    country: "Czech Republic",
    image:
      "https://images.unsplash.com/photo-1513805959324-96eb66ca8713?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "The capital city of the Czech Republic, known for its Old Town Square and historic monuments.",
    activities: "Visit Charles Bridge, Prague Castle, Old Town Square, etc.",
  },

  {
    name: "Zurich",
    country: "Switzerland",
    image:
      "https://images.unsplash.com/photo-1544207240-8b36d8c6e353?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "A global center for banking and finance, it lies at the north end of Lake Zurich in northern Switzerland.",
    activities: "Visit Lake Zurich, Old Town (Altstadt), Uetliberg, etc.",
  },
  {
    name: "Kyoto",
    country: "Japan",
    image:
      "https://images.unsplash.com/photo-1562317305-58ea61f21459?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Famous for its numerous classical Buddhist temples, as well as gardens, imperial palaces, Shinto shrines and traditional wooden houses.",
    activities: "Visit Fushimi Inari-taisha, Kinkaku-ji, Arashiyama, etc.",
  },
  {
    name: "Cairo",
    country: "Egypt",
    image:
      "https://images.unsplash.com/photo-1554704252-6c88005367e7?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Egypt's sprawling capital, set on the Nile River, is a vibrant merging of the ancient and the modern.",
    activities: "Visit the Egyptian Museum, Pyramids of Giza, The Sphinx, etc.",
  },
  {
    name: "Athens",
    country: "Greece",
    image:
      "https://images.unsplash.com/photo-1550698718-56e465f115e5?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Athens, the capital of Greece, was also at the heart of Ancient Greece, a powerful civilization and empire.",
    activities: "Visit the Acropolis Museum, Parthenon, Plaka, etc.",
  },
  {
    name: "Lisbon",
    country: "Portugal",
    image:
      "https://images.unsplash.com/photo-1541618541408-b03f24183e07?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Portugal’s hilly, coastal capital city known for its cafe culture and soulful Fado music.",
    activities:
      "Visit Belém Tower, Jerónimos Monastery, Praça do Comércio, etc.",
  },
  {
    name: "Buenos Aires",
    country: "Argentina",
    image:
      "https://images.unsplash.com/photo-1546617421-5ac6ca942434?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Buenos Aires is Argentina’s big, cosmopolitan capital city known for its preserved Spanish/European-style architecture and rich cultural life.",
    activities: "Visit the Teatro Colón, MALBA, La Boca, etc.",
  },
  {
    name: "Cape Town",
    country: "South Africa",
    image:
      "https://images.unsplash.com/photo-1535930749574-1399327ce78f?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Cape Town is a port city on South Africa’s southwest coast, on a peninsula beneath the imposing Table Mountain.",
    activities:
      "Visit Table Mountain, Kirstenbosch National Botanical Garden, Robben Island, etc.",
  },
  {
    name: "Queenstown",
    country: "New Zealand",
    image:
      "https://images.unsplash.com/photo-1556648011-1173e5578092?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    description:
      "Queenstown, New Zealand, sits on the shores of the South Island’s Lake Wakatipu, set against the dramatic Southern Alps.",
    activities:
      "Adventure sports like bungee jumping, skydiving, Visit Lake Wakatipu, etc.",
  },
  // More destinations...
];
