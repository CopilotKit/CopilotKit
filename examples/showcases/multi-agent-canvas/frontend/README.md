# Open Multi-Agent Canvas

Open Multi-Agent Canvas is an open-source multi-agent chat interface that leverages specialized agents to assist with travel planning, research, email drafting, and more. Built with Next.js, React, and CopilotKit, this project offers an interactive, unified experience by managing multiple agents within one dynamic conversation.

## Key Features

- **Multi-Agent Chat Interface:**  
  Chat with a range of specialized agents:
  - **Travel Agent:** Plan trips, create itineraries, and view travel recommendations on an interactive map powered by Leaflet.
  - **Research Agent:** Conduct research with real-time logs and progress updates.
  
- **Real-Time Interactivity:**  
  Enjoy a live chat powered by `@copilotkit/react-ui` that orchestrates dynamic state changes and agent responses.

- **State Management & Agent Coordination:**  
  Leverages `@copilotkit/react-core` for robust agent state management and smooth integration of travel and research functionalities.

- **Responsive & Modern UI:**  
  Designed with Tailwind CSS to ensure your experience is smooth and adaptive across all devices.

## Technology Stack

- **Framework:** [Next.js](https://nextjs.org)
- **UI Library:** React, [CopilotKit UI](https://www.npmjs.com/package/@copilotkit/react-ui)
- **State Management:** [CopilotKit React Core](https://www.npmjs.com/package/@copilotkit/react-core)
- **Mapping:** [Leaflet](https://leafletjs.com) with [React Leaflet](https://react-leaflet.js.org)
- **Styling:** Tailwind CSS

## Setup Instructions

1. **Prerequisites:**  
   - [Node.js](https://nodejs.org) (LTS version recommended)
   - npm or yarn

2. **Installation:**  
   ```bash
   # Clone the repository
   git clone <repository-url>
   
   # Navigate to the frontend directory
   cd frontend

   # Install dependencies
   npm install
   # or
   yarn install
   ```

3. **Running the Development Server:**  
   ```bash
   npm run dev
   # or
   yarn dev
   ```
   Then, open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

- **/src/app:**  
  Contains Next.js page components, layouts, and global styles.

- **/src/components:**  
  Houses reusable components including agent interfaces (Travel, Research, Chat, Map, Sidebar) and UI elements.

- **/providers:**  
  Wraps the global state providers responsible for managing agent states.

- **/lib:**  
  Contains utility functions and configuration files (like available agents configuration).

## Value Proposition

Open Multi-Agent Canvas simplifies complex tasks by unifying multiple specialized agents in a single, interactive chat interface. Whether you're planning a trip with an interactive map, conducting in-depth research with real-time logs, this application streamlines your workflow and provides focused assistance tailored to each task—all within one platform.

## Deployment

The easiest way to deploy this project is with [Vercel](https://vercel.com). Build and start your application with:
```bash
npm run build
npm run start
```
Follow Vercel's deployment guide for more details if needed.

## Contributing

Contributions are welcome! Fork the repository and submit a pull request with any improvements, bug fixes, or new features.

## License

Distributed under the MIT License. See `LICENSE` for more information.
