"use client";
import {
  DocumentPointer,
  useCopilotAction,
  useCopilotChat,
  useMakeCopilotDocumentReadable,
} from "@copilotkit/react-core";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import { DestinationTable } from "./destination-table";
import { VacationNotes } from "./vacation-notes";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";

export type Destination = {
  name: string;
  country: string;
  image: string;
  description: string;
  activities: string;
};

const document: DocumentPointer = {
  id: "2",
  name: "Travel Pet Peeves",
  sourceApplication: "Google Docs",
  iconImageUri: "/images/GoogleDocs.svg",
  getContents: () => {
    return [
      "1. Crowded tourist spots",
      "2. Expensive souvenirs",
      "3. Uncomfortable airplane seats",
      "4. Language barriers",
      "5. Lost luggage",
      "6. Jet lag",
      "7. Long layovers",
      "8. Unpredictable weather",
      "9. Poor internet connection",
      "10. Local cuisine not matching taste",
    ].join("\n");
  },
} as DocumentPointer;

export function VacationList() {
  const [newDestinations, setNewDestinations] = useState<Destination[]>(data.newDestinations);
  const [visitedDestinations, setVisitedDestinations] = useState<Destination[]>(
    data.visitedDestinations,
  );

  const { appendMessage } = useCopilotChat();

  useMakeCopilotDocumentReadable(document);

  useCopilotAction({
    name: "AddNewDestination",
    description: "Add a new destination to the list",
    parameters: [
      {
        name: "name",
        type: "string",
      },
      {
        name: "country",
        type: "string",
      },
      {
        name: "image",
        type: "string",
      },
      {
        name: "description",
        type: "string",
      },
      {
        name: "activities",
        type: "string",
      },
    ],
    handler: async ({ name, country, image, description, activities }) => {
      setNewDestinations((prev) => [...prev, { name, country, image, description, activities }]);
    },
  });

  useCopilotAction({
    name: "AddVisitedDestination",
    description: "Add a new visited destination to the list",
    parameters: [
      {
        name: "name",
        type: "string",
      },
      {
        name: "country",
        type: "string",
      },
      {
        name: "image",
        type: "string",
      },
      {
        name: "description",
        type: "string",
      },
      {
        name: "activities",
        type: "string",
      },
    ],
    handler: async ({ name, country, image, description, activities }) => {
      setVisitedDestinations((prev) => [
        ...prev,
        { name, country, image, description, activities },
      ]);
    },
  });

  useCopilotChatSuggestions({
    instructions:
      "Exclude already visited destinations, and New Destinations and suggest new destinations",
    maxSuggestions: 5,
  });

  /**
   * Initializes the chat interface with a welcome message when the component mounts.
   *
   * This effect:
   * - Runs once on component mount (empty dependency array)
   * - Creates a new TextMessage with the Assistant role
   * - Appends the welcome message to the chat history
   *
   * @param followUp: false - This is critical because:
   *   - When false, this message is treated as a standalone greeting
   *   - No LLM request is triggered for this message
   *   - The chat will wait for the user's first interaction before making any API calls
   *   - This helps optimize performance by avoiding unnecessary API calls for static welcome messages
   *
   * Example flow:
   * 1. Component mounts -> Welcome message appears
   * 2. No LLM call is made (followUp: false)
   * 3. User sends first message -> This will trigger the first actual LLM request
   */
  useEffect(() => {
    appendMessage(
      new TextMessage({
        role: MessageRole.Assistant,
        content: "Hi you! 👋 Let's book your next vacation. Ask me anything.",
      }),
      { followUp: false },
    );
  }, []);

  return (
    <div className="px-4 sm:px-6 lg:px-8 bg-slate-50 py-4">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-3xl font-semibold leading-6 text-gray-900">WaterBnB (Toy Example)</h1>
        </div>
      </div>
      <div className="mt-8 flow-root bg-slate-200">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <VacationNotes />
          </div>
        </div>
      </div>
      <div className="mt-8 flow-root bg-slate-200">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <DestinationTable destinations={visitedDestinations} heading="Visited Destinations" />
          </div>
        </div>
      </div>
      <div className="mt-8 flow-root bg-slate-200">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <DestinationTable destinations={newDestinations} heading="New Destinations" />
          </div>
        </div>
      </div>
    </div>
  );
}

const data: Record<string, Destination[]> = {
  visitedDestinations: [
    {
      name: "New York City",
      country: "USA",
      image: "https://worldstrides.com/wp-content/uploads/2015/07/iStock_000040849990_Large.jpg",
      description:
        'Known as "The Big Apple", famous for its high energy, arts scene, and iconic landmarks.',
      activities: "Visit the Statue of Liberty, Central Park, Times Square, etc.",
    },
    {
      name: "London",
      country: "United Kingdom",
      image:
        "https://assets.editorial.aetnd.com/uploads/2019/03/topic-london-gettyimages-760251843-feature.jpg",
      description:
        "England's capital known for its rich history, art, culture, and famous landmarks.",
      activities: "Visit the British Museum, the Tower of London, Buckingham Palace, etc.",
    },
    {
      name: "Sydney",
      country: "Australia",
      image:
        "https://media.tatler.com/photos/6141d37b9ce9874a3e40107d/16:9/w_2560%2Cc_limit/social_crop_sydney_opera_house_gettyimages-869714270.jpg",
      description:
        "Australia's biggest city known for its harbourfront Sydney Opera House, arched Harbour Bridge and Darling Harbour.",
      activities: "Visit Sydney Opera House, Sydney Harbour Bridge, Bondi Beach, etc.",
    },
  ],
  newDestinations: [
    {
      name: "Paris",
      country: "France",
      image:
        "https://th.bing.com/th/id/R.9f0633e930516f6ff470595268f58b27?rik=ha1vaHawmkpg3g&riu=http%3a%2f%2fwww.sumit4allphotography.com%2fwp-content%2fuploads%2f2015%2f04%2fparis-013.jpg&ehk=4fi64VWVWbUIYMx4LFBas8A4zxTkVTREQNlHirY2sPU%3d&risl=&pid=ImgRaw&r=0",
      description:
        'Known as the "City of Light", famous for its museums and architectural landmarks.',
      activities: "Visit Eiffel Tower, Louvre Museum, Notre-Dame, etc.",
    },
    {
      name: "Tokyo",
      country: "Japan",
      image: "https://th.bing.com/th/id/OIP.MzXk5dvbrXpDe1b8bjkfpQHaFC?pid=ImgDet&rs=1",
      description:
        "A bustling city known for its modern architecture, nightlife, and hearty street food.",
      activities: "Visit Tokyo Tower, Meiji Shrine, Tokyo Disneyland, etc.",
    },
    {
      name: "Rome",
      country: "Italy",
      image:
        "https://fthmb.tqn.com/zrONHS-4SIm0ySkio8PsrtKkl-E=/5710x3799/filters:fill(auto,1)/the-roman-coliseum-during-a-warm-spring-sunset-542105331-58f15ac63df78cd3fc763275.jpg",
      description:
        "The capital of Italy known for its ancient ruins, including the Forum and the Colosseum.",
      activities: "Visit the Vatican City, Roman Forum, Colosseum, etc.",
    },
    {
      name: "Rio de Janeiro",
      country: "Brazil",
      image:
        "https://th.bing.com/th/id/R.58c7cd07743a65337c18c919bcaa1fc5?rik=TJqBfegI01c7Gw&riu=http%3a%2f%2fwww.getsready.com%2fwp-content%2fuploads%2f2016%2f08%2fRio-de-Janeiro-an-amazing-part-in-brazil.jpg&ehk=Dx7YdRlKPvbF%2fRsGg%2fGXOhSNQyYcyiqFKpqr7IoS3s8%3d&risl=&pid=ImgRaw&r=0",
      description:
        "A huge seaside city in Brazil, known for its Copacabana and Ipanema beaches, and the Christ the Redeemer statue.",
      activities: "Visit Sugarloaf Mountain, the Christ the Redeemer statue, Ipanema Beach, etc.",
    },
    {
      name: "Istanbul",
      country: "Turkey",
      image: "https://th.bing.com/th/id/OIP.S4Al32XFCu0bS99Tf2DCnwHaE8?pid=ImgDet&rs=1",
      description:
        "A city straddling Europe and Asia across the Bosphorus Strait, known for its historic sites.",
      activities: "Visit Hagia Sophia, Blue Mosque, Topkapi Palace, etc.",
    },
    {
      name: "Bali",
      country: "Indonesia",
      image:
        "https://th.bing.com/th/id/R.3a2422d39d9999c93c3438d9b4950d95?rik=GOiVPf3Xb26%2fpw&riu=http%3a%2f%2fwww.absolutemagazine.co.uk%2fwp-content%2fuploads%2f2017%2f11%2f2017_03_20_23739_1489984971._large.jpg&ehk=aNYxygLXB2jpi%2bCLdISg3BCYhHFUk61mcrqviLq9pmk%3d&risl=&pid=ImgRaw&r=0",
      description:
        "An Indonesian island known for its forested volcanic mountains, iconic rice paddies, beaches and coral reefs.",
      activities: "Visit Ubud, Seminyak, Nusa Dua, etc.",
    },
    {
      name: "Vienna",
      country: "Austria",
      image: "https://lp-cms-production.imgix.net/2020-11/500pxRF_124014183.jpg",
      description:
        "A city marked by its imperial palaces and musical heritage, located on the Danube River.",
      activities: "Visit Schönbrunn Palace, St. Stephen's Cathedral, Vienna State Opera, etc.",
    },
    {
      name: "Havana",
      country: "Cuba",
      image:
        "data:image/jpeg;base64,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",
      description:
        "Cuba's capital, a city carrying the scent of the old world with its well-preserved Spanish colonial architecture.",
      activities: "Visit Old Havana, Morro Castle, Malecón, etc.",
    },
    {
      name: "Dubai",
      country: "United Arab Emirates",
      image:
        "https://cloudfront-us-east-2.images.arcpublishing.com/reuters/TECHZMXJDZIZ3MSPVCWBOGTK6Y.jpg",
      description:
        "A city known for its modern architecture, luxury shopping, and a lively nightlife scene.",
      activities: "Visit Burj Khalifa, Dubai Mall, Palm Jumeirah, etc.",
    },
    {
      name: "Edinburgh",
      country: "Scotland",
      image:
        "https://static.nationalgeographic.co.uk/files/styles/image_3200/public/neighbourhood_edinburgh_awl_sco35873aw_hr.jpg?w=1600",
      description: "Scotland's compact, hilly capital known for its historical sites.",
      activities: "Visit Edinburgh Castle, Arthur's Seat, Royal Mile, etc.",
    },
    {
      name: "Marrakesh",
      country: "Morocco",
      image:
        "https://www.nomadicchica.com/en/productive/wp-content/uploads/2020/02/Marrakesh-best-things-to-do-Morocco-Woman-Gloria-Apara-Nomadicchica.com-7.jpg",
      description: "A city steeped in rich history and culture, known for its palaces and gardens.",
      activities: "Visit Jardin Majorelle, Koutoubia Mosque, Bahia Palace, etc.",
    },
    {
      name: "Prague",
      country: "Czech Republic",
      image:
        "https://a.cdn-hotels.com/gdcs/production76/d1135/21203dce-feeb-40f3-8c93-fc1a98f7549a.jpg?impolicy=fcrop&w=800&h=533&q=medium",
      description:
        "The capital city of the Czech Republic, known for its Old Town Square and historic monuments.",
      activities: "Visit Charles Bridge, Prague Castle, Old Town Square, etc.",
    },

    {
      name: "Zurich",
      country: "Switzerland",
      image:
        "https://a.cdn-hotels.com/gdcs/production127/d484/b9ca99c3-b15e-48ab-a3cb-983186637256.jpg?impolicy=fcrop&w=800&h=533&q=medium",
      description:
        "A global center for banking and finance, it lies at the north end of Lake Zurich in northern Switzerland.",
      activities: "Visit Lake Zurich, Old Town (Altstadt), Uetliberg, etc.",
    },
    {
      name: "Kyoto",
      country: "Japan",
      image:
        "https://e5rxtr4t5ah.exactdn.com/wp-content/uploads/2018/05/kyoto-4-day-itinerary-header.jpg",
      description:
        "Famous for its numerous classical Buddhist temples, as well as gardens, imperial palaces, Shinto shrines and traditional wooden houses.",
      activities: "Visit Fushimi Inari-taisha, Kinkaku-ji, Arashiyama, etc.",
    },
    {
      name: "Cairo",
      country: "Egypt",
      image:
        "https://lp-cms-production.imgix.net/features/2018/03/islamic-cairo-egypt-324042f64d76.jpg?auto=format&q=75&w=1920",
      description:
        "Egypt's sprawling capital, set on the Nile River, is a vibrant merging of the ancient and the modern.",
      activities: "Visit the Egyptian Museum, Pyramids of Giza, The Sphinx, etc.",
    },
    {
      name: "Athens",
      country: "Greece",
      image:
        "https://dynamic-media-cdn.tripadvisor.com/media/photo-o/1c/c0/98/c5/caption.jpg?w=700&h=-1&s=1&cx=960&cy=638&chk=v1_dd51d42e9a888a6b338f",
      description:
        "Athens, the capital of Greece, was also at the heart of Ancient Greece, a powerful civilization and empire.",
      activities: "Visit the Acropolis Museum, Parthenon, Plaka, etc.",
    },
    {
      name: "Lisbon",
      country: "Portugal",
      image:
        "https://www.travelandleisure.com/thmb/LzWpzDihxjffaFmM9TZWCvm9VyY=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/lisbon-portugal-LISBONTG0521-c933a0fb669647619fa580f6c602c4c8.jpg",
      description:
        "Portugal's hilly, coastal capital city known for its cafe culture and soulful Fado music.",
      activities: "Visit Belém Tower, Jerónimos Monastery, Praça do Comércio, etc.",
    },
    {
      name: "Buenos Aires",
      country: "Argentina",
      image:
        "https://lp-cms-production.imgix.net/2021-09/La%20Boca%2C%20Buenos%20Aires%2C%20Argentina.jpg",
      description:
        "Buenos Aires is Argentina's big, cosmopolitan capital city known for its preserved Spanish/European-style architecture and rich cultural life.",
      activities: "Visit the Teatro Colón, MALBA, La Boca, etc.",
    },
    {
      name: "Cape Town",
      country: "South Africa",
      image:
        "https://media.discoverafrica.com/wp-content/uploads/2022/07/iStock-1371129172-scaled.jpg?strip=all&lossy=1&ssl=1",
      description:
        "Cape Town is a port city on South Africa's southwest coast, on a peninsula beneath the imposing Table Mountain.",
      activities:
        "Visit Table Mountain, Kirstenbosch National Botanical Garden, Robben Island, etc.",
    },
    {
      name: "Queenstown",
      country: "New Zealand",
      image:
        "https://www.newzealand.com/assets/Operator-Database/img-1612224709-7722-18346-sel-20452d-summer-brand-campaign-web-banner-1920x1280-dining__aWxvdmVrZWxseQo_CropResizeWzEyMDAsNjMwLDc1LCJqcGciXQ.jpg",
      description:
        "Queenstown, New Zealand, sits on the shores of the South Island's Lake Wakatipu, set against the dramatic Southern Alps.",
      activities: "Adventure sports like bungee jumping, skydiving, Visit Lake Wakatipu, etc.",
    },
    // More destinations...
  ],
};
