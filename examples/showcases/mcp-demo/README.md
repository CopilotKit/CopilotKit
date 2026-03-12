<div align="center">

# Working Memory
   
![CopilotKit-Banner](https://github.com/user-attachments/assets/8167c845-0381-45d9-ad1c-83f995d48290)
</div>

Working Memory is an example for the implementation of the MCP server-client integrations to handle and manage your projects and tasks from your project management applications like Linear.

## Key Features

- **CopilotKit AI Chat Interface:**  
  Chat with the CopilotKit AI which acts as useful assitant who can able to provide answers to user queries and perform executable actions inside the application.
  
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

- **Styling:** Tailwind CSS
- **Additional Libraries:**
  - React Query for data fetching
  - Framer Motion for animations
  - Radix UI for accessible components
  - React Flow for flow diagrams

## Setup Instructions

1. **Prerequisites:**  
   - [Node.js](https://nodejs.org) (LTS version recommended)
   - npm, yarn, or pnpm

2. **Installation:**  
   ```bash
   # Clone the repository
   git clone <repository-url>
   
   # Install dependencies
   npm install
   # or
   yarn install
   # or
   pnpm install
   ```

3. **Environment Setup:**  
   Create a `.env` file in the root directory with the necessary environment variables.
   ```bash
    OPENAI_API_KEY = YOUR_API_KEY
   ```

4. **Running the Development Server:**  
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   ```
   Then, open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

- **/src/app:**  
  Contains Next.js page components, layouts, and global styles.

- **/src/components:**  
  Houses reusable components including agent interfaces (Travel, Research, Chat, Map, Sidebar) and UI elements.

- **/src/providers:**  
  Wraps the global state providers responsible for managing agent states.

- **/src/lib:**  
  Contains utility functions and configuration files.

- **/src/hooks:**  
  Custom React hooks for shared functionality.

- **/src/contexts:**  
  React context providers for global state management.

## Development

- **Linting:**  
  ```bash
  npm run lint
  # or
  yarn lint
  # or
  pnpm lint
  ```

- **Building for Production:**  
  ```bash
  npm run build
  # or
  yarn build
  # or
  pnpm build
  ```

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
