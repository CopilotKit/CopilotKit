## AI-Powered Open-Source Financial Manager


## Use Case 
An AI-powered open-source Financial Manager that helps you plan your savings and investments.


## Technologies Used 
- Next.js
- CopilotKit
- Maybe Finance + Synth
- Shadcn-UI Component Styling
- MongoDB Vector Database
- Recharts for visualization
- Google OAuth with NextAuth.js
  

## GitHub + YouTube

- [ ] GitHub Repo:
https://github.com/Tabintel/finance_ai

- [ ] YouTube: 
https://www.youtube.com/watch?v=Pn-pONOwfwg&embeds_referring_euri=https%3A%2F%2Fdev.to%2F

![image](https://github.com/user-attachments/assets/26e9cdb5-f667-421f-a58d-b97e0877bd06)


## Who Are You?
I'm Ekemini, a Technical writer and Software developer, we can connect on [Twitter](https://twitter.com/realEkemini) and [LinkedIn](https://www.linkedin.com/in/ekeminisamuel/). 


## ⭐️ Project README with installation and getting started steps ⭐️👇

## AI-Powered Financial Insights

<div align="center">
  
![finance app](https://github.com/user-attachments/assets/5a5e9582-e183-43ca-b936-9b12aa9fa24b)
  
<p><em>Your AI-powered financial companion</em></p>
</div>

Coyamin is an AI-powered financial insights application that helps users understand and optimize their personal finances. Built with Next.js, CopilotKit for AI assistance, and Maybe Finance API for financial data.

## Features

- **Personalized Financial Dashboard**: View your financial health at a glance
- **AI Financial Assistant**: Get personalized financial advice with CopilotKit
- **Intelligent Onboarding**: Answer questions to generate tailored financial insights
- **Investment Analysis**: Visualize your investment portfolio and asset allocation
- **Currency & Market Data**: Access real-time financial market data

## Tech Stack

- **Frontend**: Next.js 14+, React, Tailwind CSS
- **AI Integration**: CopilotKit
- **Financial Data**: Maybe Finance API
- **Authentication**: Google OAuth with NextAuth.js
- **Visualization**: Recharts

## Installation

### Prerequisites

- Node.js 18+ and npm
- Accounts for:
  - Google Cloud Platform (for OAuth)
  - [CopilotKit](https://docs.copilotkit.ai/) (AI assistant)
  - [Maybe Finance](https://synthfinance.com/) (financial data API)
- MongoDB database

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Tabintel/ai-savings.git
   cd ai-savings
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cd .env.example .env
   ```

4. Fill in your API keys and environment variables in the `.env` file

5. Run the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
ai-savings
├─ app/                    # Next.js application
│  ├─ (auth)/              # Authentication routes
│  ├─ api/                 # API routes
│  │  ├─ currencies/       # Currency data endpoints
│  │  ├─ enrich/           # Financial data enrichment
│  │  └─ rates/            # Exchange rates
│  ├─ dashboard/           # Main dashboard page
│  ├─ onboarding/          # User onboarding flow
│  └─ layout.tsx           # Root layout component
├─ components/             # Shared components
├─ lib/                    # Utility functions and services
└─ public/                 # Static assets
```

## Environment Variables

See `.env.example` for required environment variables.

## Deployment

The application can be deployed on Vercel, Netlify, or any hosting service that supports Next.js.

```bash
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
