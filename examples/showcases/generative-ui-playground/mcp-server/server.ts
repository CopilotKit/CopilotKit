/**
 * MCP Server for UI Protocols Demo.
 * Registers 6 interactive apps with UI resources:
 * - Flights: Multi-step flight booking wizard
 * - Hotels: Multi-step hotel booking wizard
 * - Trading: Investment portfolio simulator
 * - Kanban: Task board with drag-drop
 * - Calculator: Expression evaluator (NEW)
 * - Todo: Task list manager (NEW)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  isInitializeRequest,
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import cors from "cors";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Import flights logic
import {
  searchFlights,
  selectFlight,
  selectSeats,
  createBooking,
} from "./src/flights.js";

// Import hotels logic
import {
  searchHotels,
  selectHotel,
  selectRoom,
  createHotelBooking,
} from "./src/hotels.js";

// Import trading logic
import {
  createPortfolio,
  executeTrade,
  refreshPrices,
  getStocks,
  type Portfolio,
  type Sector,
  type TradeType,
} from "./src/stocks.js";

// Import kanban logic
import {
  createBoard,
  addCard,
  updateCard,
  deleteCard,
  moveCard,
  Board,
} from "./src/kanban.js";

// Import calculator logic (NEW)
import {
  createCalculator,
  inputCalculator,
  evaluateExpression,
  clearHistory,
  CalculatorState,
} from "./src/calculator.js";

// Import todo logic (NEW)
import {
  createTodoList,
  addTodoItem,
  completeTodoItem,
  reopenTodoItem,
  deleteTodoItem,
  clearCompleted,
  TodoList,
} from "./src/todo.js";

// MCP Apps Extension protocol constant
const RESOURCE_URI_META_KEY = "ui/resourceUri";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store active portfolios by session
const activePortfolios: Map<string, Portfolio> = new Map();

// Store active boards by session
const activeBoards: Map<string, Board> = new Map();

// Store active calculators by session (NEW)
const activeCalculators: Map<string, CalculatorState> = new Map();

// Store active todo lists by session (NEW)
const activeTodoLists: Map<string, TodoList> = new Map();

// Load UI HTML file from apps/ directory
const loadHtml = async (name: string): Promise<string> => {
  const htmlPath = path.join(__dirname, "apps", `${name}.html`);
  try {
    return await fs.readFile(htmlPath, "utf-8");
  } catch {
    // Return placeholder HTML if not found
    return `<!DOCTYPE html>
<html>
<head><title>${name}</title></head>
<body>
  <div style="padding: 20px; font-family: system-ui;">
    <h2>${name} Loading...</h2>
    <p>App HTML not found at ${htmlPath}</p>
  </div>
</body>
</html>`;
  }
};

// Create the MCP server instance
const getServer = async () => {
  const server = new McpServer(
    {
      name: "ui-protocols-mcp-server",
      version: "1.0.0",
    },
    { capabilities: { logging: {} } },
  );

  // Load app HTML files
  const flightsAppHtml = await loadHtml("flights-app");
  const hotelsAppHtml = await loadHtml("hotels-app");
  const tradingAppHtml = await loadHtml("trading-app");
  const kanbanAppHtml = await loadHtml("kanban-app");
  const calculatorAppHtml = await loadHtml("calculator-app");
  const todoAppHtml = await loadHtml("todo-app");

  // Helper to register a resource
  const registerResource = (resource: Resource, htmlContent: string) => {
    server.registerResource(
      resource.name,
      resource.uri,
      resource,
      async (): Promise<ReadResourceResult> => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: htmlContent,
          },
        ],
      }),
    );
    return resource;
  };

  // ============================================
  // RESOURCE REGISTRATIONS
  // ============================================

  // Register the flights app UI resource
  const flightsResource = registerResource(
    {
      name: "flights-app-template",
      uri: "ui://flights/flights-app.html",
      title: "Airline Booking",
      description:
        "Interactive flight search and booking wizard with seat selection",
      mimeType: "text/html+mcp",
    },
    flightsAppHtml,
  );

  // Register the hotels app UI resource
  const hotelsResource = registerResource(
    {
      name: "hotels-app-template",
      uri: "ui://hotels/hotels-app.html",
      title: "Hotel Booking",
      description:
        "Interactive hotel search and booking wizard with room selection",
      mimeType: "text/html+mcp",
    },
    hotelsAppHtml,
  );

  // Register the trading app UI resource
  const tradingResource = registerResource(
    {
      name: "trading-app-template",
      uri: "ui://trading/trading-app.html",
      title: "Investment Simulator",
      description:
        "Interactive portfolio UI with holdings, charts, and trading",
      mimeType: "text/html+mcp",
    },
    tradingAppHtml,
  );

  // Register the kanban app UI resource
  const kanbanResource = registerResource(
    {
      name: "kanban-app-template",
      uri: "ui://kanban/kanban-app.html",
      title: "Kanban Board",
      description: "Interactive task board with drag-drop cards and columns",
      mimeType: "text/html+mcp",
    },
    kanbanAppHtml,
  );

  // Register the calculator app UI resource (NEW)
  const calculatorResource = registerResource(
    {
      name: "calculator-app-template",
      uri: "ui://calculator/calculator-app.html",
      title: "Calculator",
      description: "Interactive calculator with memory and history",
      mimeType: "text/html+mcp",
    },
    calculatorAppHtml,
  );

  // Register the todo app UI resource (NEW)
  const todoResource = registerResource(
    {
      name: "todo-app-template",
      uri: "ui://todo/todo-app.html",
      title: "Todo List",
      description: "Interactive task manager with priorities and filters",
      mimeType: "text/html+mcp",
    },
    todoAppHtml,
  );

  // ============================================
  // AIRLINE BOOKING TOOLS
  // ============================================

  // Register search-flights tool (main tool with UI)
  server.registerTool(
    "search-flights",
    {
      title: "Search Flights",
      description:
        "Searches for available flights between two airports. Returns an interactive booking wizard UI.",
      inputSchema: {
        origin: z
          .string()
          .describe("Origin airport code (e.g., JFK, LAX, LHR)"),
        destination: z.string().describe("Destination airport code"),
        departureDate: z
          .string()
          .describe("Departure date in YYYY-MM-DD format"),
        passengers: z
          .number()
          .min(1)
          .max(9)
          .describe("Number of passengers (1-9)"),
        cabinClass: z
          .enum(["economy", "business", "first"])
          .optional()
          .describe("Cabin class (default: economy)"),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: flightsResource.uri,
      },
    },
    async ({
      origin,
      destination,
      departureDate,
      passengers,
      cabinClass,
    }): Promise<CallToolResult> => {
      try {
        const search = searchFlights({
          origin,
          destination,
          departureDate,
          passengers,
          cabinClass: cabinClass || "economy",
        });

        const flightSummary = search.flights
          .slice(0, 3)
          .map(
            (f) =>
              `${f.airline.code}${f.flightNumber.slice(2)} ${f.departureTime}-${f.arrivalTime} $${f.price}`,
          )
          .join(", ");

        return {
          content: [
            {
              type: "text",
              text: `Found ${search.flights.length} flights from ${origin} to ${destination} on ${departureDate}:\n\n${flightSummary}...`,
            },
          ],
          structuredContent: {
            search,
            summary: {
              flightCount: search.flights.length,
              origin,
              destination,
              date: departureDate,
              passengers,
            },
          },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error: ${(error as Error).message}` },
          ],
          structuredContent: {
            success: false,
            error: (error as Error).message,
          },
        };
      }
    },
  );

  // Register select-flight tool (helper for UI)
  server.registerTool(
    "select-flight",
    {
      title: "Select Flight",
      description:
        "Selects a flight from search results and returns the seat map",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        flightId: z.string().describe("The flight ID to select"),
      },
    },
    async ({ searchId, flightId }): Promise<CallToolResult> => {
      const result = selectFlight(searchId, flightId);

      if (!result) {
        return {
          content: [{ type: "text", text: "Flight or search not found." }],
          structuredContent: {
            success: false,
            error: "Flight or search not found",
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Selected ${result.flight.airline.name} ${result.flight.flightNumber} (${result.flight.departureTime}-${result.flight.arrivalTime}). Please choose your seats.`,
          },
        ],
        structuredContent: {
          success: true,
          flight: result.flight,
          seatMap: result.seatMap,
        },
      };
    },
  );

  // Register select-seats tool (helper for UI)
  server.registerTool(
    "select-seats",
    {
      title: "Select Seats",
      description: "Selects seats for the chosen flight",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        flightId: z.string().describe("The flight ID"),
        seats: z
          .array(z.string())
          .describe("Array of seat IDs (e.g., ['12A', '12B'])"),
      },
    },
    async ({ searchId, flightId, seats }): Promise<CallToolResult> => {
      const result = selectSeats(searchId, flightId, seats);

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: result.success,
          selectedSeats: result.selectedSeats,
          totalSeatFee: result.totalSeatFee,
          error: result.success ? undefined : result.message,
        },
      };
    },
  );

  // Register book-flight tool (helper for UI)
  server.registerTool(
    "book-flight",
    {
      title: "Book Flight",
      description: "Completes the flight booking with passenger details",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        passengers: z
          .array(
            z.object({
              name: z.string().describe("Passenger full name"),
              email: z.string().describe("Passenger email"),
              phone: z.string().describe("Passenger phone number"),
            }),
          )
          .describe("Passenger information"),
      },
    },
    async ({ searchId, passengers }): Promise<CallToolResult> => {
      const result = createBooking(searchId, passengers);

      if (!result.success || !result.booking) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Booking confirmed! Confirmation: ${result.booking.confirmationNumber}\n\nFlight: ${result.booking.flight.airline.name} ${result.booking.flight.flightNumber}\nRoute: ${result.booking.flight.origin.code} → ${result.booking.flight.destination.code}\nSeats: ${result.booking.seats.join(", ")}\nTotal: $${result.booking.totalPrice.toFixed(2)}`,
          },
        ],
        structuredContent: {
          success: true,
          booking: result.booking,
        },
      };
    },
  );

  // ============================================
  // HOTEL BOOKING TOOLS
  // ============================================

  // Register search-hotels tool (main tool with UI)
  server.registerTool(
    "search-hotels",
    {
      title: "Search Hotels",
      description:
        "Searches for available hotels in a city. Returns an interactive booking wizard UI.",
      inputSchema: {
        city: z.string().describe("City name (e.g., Paris, New York, Tokyo)"),
        checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
        checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
        guests: z.number().min(1).max(6).describe("Number of guests (1-6)"),
        rooms: z
          .number()
          .min(1)
          .max(4)
          .optional()
          .describe("Number of rooms needed (default: 1)"),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: hotelsResource.uri,
      },
    },
    async ({
      city,
      checkIn,
      checkOut,
      guests,
      rooms,
    }): Promise<CallToolResult> => {
      try {
        const search = searchHotels({
          city,
          checkIn,
          checkOut,
          guests,
          rooms: rooms || 1,
        });

        // Calculate nights for display
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const nights = Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        const hotelSummary = search.hotels
          .slice(0, 3)
          .map(
            (h) => `${h.name} (${h.rating}/10) from $${h.priceRange.min}/night`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${search.hotels.length} hotels in ${city} for ${nights} night(s):\n\n${hotelSummary}`,
            },
          ],
          structuredContent: {
            search,
            summary: {
              hotelCount: search.hotels.length,
              city,
              checkIn,
              checkOut,
              nights,
              guests,
            },
          },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error: ${(error as Error).message}` },
          ],
          structuredContent: {
            success: false,
            error: (error as Error).message,
          },
        };
      }
    },
  );

  // Register select-hotel tool (helper for UI)
  server.registerTool(
    "select-hotel",
    {
      title: "Select Hotel",
      description:
        "Selects a hotel from search results and returns available rooms",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        hotelId: z.string().describe("The hotel ID to select"),
      },
    },
    async ({ searchId, hotelId }): Promise<CallToolResult> => {
      const result = selectHotel(searchId, hotelId);

      if (!result) {
        return {
          content: [{ type: "text", text: "Hotel or search not found." }],
          structuredContent: {
            success: false,
            error: "Hotel or search not found",
          },
        };
      }

      const roomSummary = result.rooms
        .map((r) => `${r.name}: $${r.pricePerNight}/night`)
        .join(", ");

      return {
        content: [
          {
            type: "text",
            text: `Selected ${result.hotel.name} (${result.hotel.rating}/10). Available rooms: ${roomSummary}`,
          },
        ],
        structuredContent: {
          success: true,
          hotel: result.hotel,
          rooms: result.rooms,
        },
      };
    },
  );

  // Register select-room tool (helper for UI)
  server.registerTool(
    "select-room",
    {
      title: "Select Room",
      description: "Selects a room type for the booking",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        roomId: z.string().describe("The room type ID"),
      },
    },
    async ({ searchId, roomId }): Promise<CallToolResult> => {
      const result = selectRoom(searchId, roomId);

      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: "Room selection failed. Hotel not selected or room not found.",
            },
          ],
          structuredContent: { success: false, error: "Room selection failed" },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Selected ${result.room.name} - $${result.priceBreakdown.perNight}/night for ${result.priceBreakdown.nights} night(s). Total: $${result.priceBreakdown.total}`,
          },
        ],
        structuredContent: {
          success: true,
          room: result.room,
          priceBreakdown: result.priceBreakdown,
        },
      };
    },
  );

  // Register book-hotel tool (helper for UI)
  server.registerTool(
    "book-hotel",
    {
      title: "Book Hotel",
      description: "Completes the hotel booking with guest details",
      inputSchema: {
        searchId: z.string().describe("The search session ID"),
        guests: z
          .array(
            z.object({
              firstName: z.string().describe("Guest first name"),
              lastName: z.string().describe("Guest last name"),
              email: z.string().describe("Guest email"),
              phone: z.string().describe("Guest phone"),
            }),
          )
          .describe("Guest information"),
      },
    },
    async ({ searchId, guests }): Promise<CallToolResult> => {
      const result = createHotelBooking(searchId, guests);

      if (!result.success || !result.booking) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Booking confirmed! Confirmation: ${result.booking.confirmationNumber}\n\nHotel: ${result.booking.hotel.name}\nRoom: ${result.booking.room.name}\nDates: ${result.booking.checkIn} to ${result.booking.checkOut} (${result.booking.nights} nights)\nTotal: $${result.booking.totalPrice.toFixed(2)}`,
          },
        ],
        structuredContent: {
          success: true,
          booking: result.booking,
        },
      };
    },
  );

  // ============================================
  // INVESTMENT SIMULATOR TOOLS
  // ============================================

  // Register create-portfolio tool (main tool with UI)
  server.registerTool(
    "create-portfolio",
    {
      title: "Create Portfolio",
      description:
        "Creates an investment portfolio based on initial balance, risk tolerance, and focus area. Returns an interactive UI for trading.",
      inputSchema: {
        initialBalance: z
          .number()
          .min(1000)
          .max(1000000)
          .describe("Starting cash balance (1000-1000000)"),
        riskTolerance: z
          .enum(["conservative", "moderate", "aggressive"])
          .describe("Risk tolerance level"),
        focus: z
          .enum([
            "technology",
            "healthcare",
            "finance",
            "consumer",
            "energy",
            "industrial",
          ])
          .optional()
          .describe("Portfolio focus area (sector)"),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: tradingResource.uri,
      },
    },
    async ({
      initialBalance,
      riskTolerance,
      focus,
    }): Promise<CallToolResult> => {
      // Create the portfolio
      const portfolio = createPortfolio({
        initialBalance,
        riskTolerance,
        focus: focus as Sector | undefined,
      });

      // Get available stocks for the UI
      const allStocks = getStocks();
      const holdingSymbols = new Set(portfolio.holdings.map((h) => h.symbol));
      const availableStocks = allStocks.filter(
        (s) => !holdingSymbols.has(s.symbol),
      );

      // Store portfolio for later trades
      activePortfolios.set(portfolio.id, portfolio);

      // Build holdings summary
      const holdingsSummary = portfolio.holdings
        .slice(0, 3)
        .map(
          (h: { symbol: string; shares: number }) =>
            `${h.symbol}: ${h.shares} shares`,
        )
        .join(", ");

      const plSign = portfolio.totalGain >= 0 ? "+" : "";

      return {
        content: [
          {
            type: "text",
            text: `Created ${focus || "diversified"} portfolio ($${initialBalance.toLocaleString()}, ${riskTolerance} risk):\n\nTotal Value: $${portfolio.totalValue.toLocaleString()}\nP/L: ${plSign}$${portfolio.totalGain.toFixed(2)}\nCash: $${portfolio.cashBalance.toLocaleString()}\n\nHoldings: ${holdingsSummary}...`,
          },
        ],
        structuredContent: {
          portfolio,
          availableStocks,
          summary: {
            totalValue: portfolio.totalValue,
            gain: portfolio.totalGain,
            gainPercent: portfolio.totalGainPercent,
            cash: portfolio.cashBalance,
            holdingsCount: portfolio.holdings.length,
          },
        },
      };
    },
  );

  // Register execute-trade tool (helper for UI callbacks)
  server.registerTool(
    "execute-trade",
    {
      title: "Execute Trade",
      description: "Buys or sells shares of a stock in the portfolio",
      inputSchema: {
        portfolioId: z.string().describe("The portfolio ID"),
        symbol: z.string().describe("Stock symbol to trade"),
        action: z.enum(["buy", "sell"]).describe("Trade action"),
        quantity: z.number().min(1).describe("Number of shares"),
      },
    },
    async ({
      portfolioId,
      symbol,
      action,
      quantity,
    }): Promise<CallToolResult> => {
      const result = executeTrade(
        portfolioId,
        action as TradeType,
        symbol,
        quantity,
      );

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored portfolio
      if (result.portfolio) {
        activePortfolios.set(portfolioId, result.portfolio);
      }

      // Get available stocks for the UI
      const allStocks = getStocks();
      const holdingSymbols = new Set(
        result.portfolio?.holdings.map((h) => h.symbol) || [],
      );
      const availableStocks = allStocks.filter(
        (s) => !holdingSymbols.has(s.symbol),
      );

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          trade: result.trade,
          portfolio: result.portfolio,
          availableStocks,
        },
      };
    },
  );

  // Register refresh-prices tool (helper for UI)
  server.registerTool(
    "refresh-prices",
    {
      title: "Refresh Prices",
      description: "Simulates market movement by updating stock prices",
      inputSchema: {
        portfolioId: z.string().describe("The portfolio ID"),
      },
    },
    async ({ portfolioId }): Promise<CallToolResult> => {
      const portfolio = refreshPrices(portfolioId);

      if (!portfolio) {
        return {
          content: [
            { type: "text", text: `Portfolio ${portfolioId} not found.` },
          ],
          structuredContent: { success: false, error: "Portfolio not found" },
        };
      }

      // Update stored portfolio
      activePortfolios.set(portfolioId, portfolio);

      // Get available stocks for the UI
      const allStocks = getStocks();
      const holdingSymbols = new Set(portfolio.holdings.map((h) => h.symbol));
      const availableStocks = allStocks.filter(
        (s) => !holdingSymbols.has(s.symbol),
      );

      const plSign = portfolio.totalGain >= 0 ? "+" : "";

      return {
        content: [
          {
            type: "text",
            text: `Prices refreshed. Portfolio: $${portfolio.totalValue.toLocaleString()} (${plSign}$${portfolio.totalGain.toFixed(2)})`,
          },
        ],
        structuredContent: {
          success: true,
          portfolio,
          availableStocks,
        },
      };
    },
  );

  // ============================================
  // KANBAN BOARD TOOLS
  // ============================================

  // Register create-board tool (main tool with UI)
  server.registerTool(
    "create-board",
    {
      title: "Create Kanban Board",
      description:
        "Creates a kanban board for project management with customizable columns and cards. Returns an interactive drag-drop UI.",
      inputSchema: {
        projectName: z.string().describe("Name for the project board"),
        template: z
          .enum(["blank", "software", "marketing", "personal"])
          .describe(
            "Board template with pre-configured columns and sample cards",
          ),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: kanbanResource.uri,
      },
    },
    async ({ projectName, template }): Promise<CallToolResult> => {
      // Create the board
      const board = createBoard(projectName, template);

      // Store board for later operations
      activeBoards.set(board.id, board);

      const totalCards = board.columns.reduce(
        (sum, c) => sum + c.cards.length,
        0,
      );

      return {
        content: [
          {
            type: "text",
            text: `Created "${projectName}" board (${template} template):\n\nColumns: ${board.columns.map((c) => c.name).join(", ")}\nTotal cards: ${totalCards}`,
          },
        ],
        structuredContent: {
          board,
          summary: {
            name: board.name,
            columnsCount: board.columns.length,
            cardsCount: totalCards,
            template,
          },
        },
      };
    },
  );

  // Register move-card tool (helper for drag-drop)
  server.registerTool(
    "move-card",
    {
      title: "Move Card",
      description: "Moves a card to a different column on the board",
      inputSchema: {
        boardId: z.string().describe("The board ID"),
        cardId: z.string().describe("The card ID to move"),
        targetColumnId: z.string().describe("Target column ID"),
        position: z
          .number()
          .optional()
          .describe("Position in column (default: end)"),
      },
    },
    async ({
      boardId,
      cardId,
      targetColumnId,
      position,
    }): Promise<CallToolResult> => {
      const result = moveCard(boardId, cardId, targetColumnId, position);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored board
      if (result.board) {
        activeBoards.set(boardId, result.board);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          board: result.board,
          card: result.card,
        },
      };
    },
  );

  // Register add-card tool (helper for UI)
  server.registerTool(
    "add-card",
    {
      title: "Add Card",
      description: "Adds a new card to a column",
      inputSchema: {
        boardId: z.string().describe("The board ID"),
        columnId: z.string().describe("The column ID"),
        title: z.string().describe("Card title"),
        description: z.string().optional().describe("Card description"),
        priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Card priority"),
      },
    },
    async ({
      boardId,
      columnId,
      title,
      description,
      priority,
    }): Promise<CallToolResult> => {
      const result = addCard(boardId, columnId, {
        title,
        description,
        priority: priority || "medium",
        tags: [],
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored board
      if (result.board) {
        activeBoards.set(boardId, result.board);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          board: result.board,
          card: result.card,
        },
      };
    },
  );

  // Register update-card tool (helper for UI)
  server.registerTool(
    "update-card",
    {
      title: "Update Card",
      description: "Updates an existing card's title, description, or priority",
      inputSchema: {
        boardId: z.string().describe("The board ID"),
        cardId: z.string().describe("The card ID"),
        updates: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            priority: z.enum(["low", "medium", "high"]).optional(),
          })
          .describe("Fields to update"),
      },
    },
    async ({ boardId, cardId, updates }): Promise<CallToolResult> => {
      const result = updateCard(boardId, cardId, updates);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored board
      if (result.board) {
        activeBoards.set(boardId, result.board);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          board: result.board,
          card: result.card,
        },
      };
    },
  );

  // Register delete-card tool (helper for UI)
  server.registerTool(
    "delete-card",
    {
      title: "Delete Card",
      description: "Removes a card from the board",
      inputSchema: {
        boardId: z.string().describe("The board ID"),
        cardId: z.string().describe("The card ID to delete"),
      },
    },
    async ({ boardId, cardId }): Promise<CallToolResult> => {
      const result = deleteCard(boardId, cardId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored board
      if (result.board) {
        activeBoards.set(boardId, result.board);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          board: result.board,
          deletedCard: result.card,
        },
      };
    },
  );

  // ============================================
  // CALCULATOR TOOLS (NEW)
  // ============================================

  // Register open-calculator tool (main tool with UI)
  server.registerTool(
    "open-calculator",
    {
      title: "Open Calculator",
      description:
        "Opens an interactive calculator with memory and history features.",
      inputSchema: {},
      _meta: {
        [RESOURCE_URI_META_KEY]: calculatorResource.uri,
      },
    },
    async (): Promise<CallToolResult> => {
      // Create a new calculator session
      const state = createCalculator();

      // Store for later operations
      activeCalculators.set(state.id, state);

      return {
        content: [
          {
            type: "text",
            text: `Calculator opened. Ready for calculations.`,
          },
        ],
        structuredContent: {
          state,
          summary: {
            calculatorId: state.id,
            display: state.display,
            memorySet: state.memory !== 0,
          },
        },
      };
    },
  );

  // Register input-calculator tool (helper for UI button presses)
  server.registerTool(
    "input-calculator",
    {
      title: "Input to Calculator",
      description:
        "Sends input to the calculator (digit, operator, or command)",
      inputSchema: {
        calculatorId: z.string().describe("The calculator session ID"),
        input: z
          .string()
          .describe(
            "Input: digit (0-9), operator (+,-,*,/), decimal (.), equals (=), clear (C), etc.",
          ),
      },
    },
    async ({ calculatorId, input }): Promise<CallToolResult> => {
      const result = inputCalculator(calculatorId, input);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored state
      if (result.state) {
        activeCalculators.set(calculatorId, result.state);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          state: result.state,
          result: result.result,
        },
      };
    },
  );

  // Register evaluate-expression tool (helper for direct evaluation)
  server.registerTool(
    "evaluate-expression",
    {
      title: "Evaluate Expression",
      description: "Evaluates a mathematical expression directly",
      inputSchema: {
        calculatorId: z.string().describe("The calculator session ID"),
        expression: z
          .string()
          .describe("Mathematical expression (e.g., '2+2', '100*5/2')"),
      },
    },
    async ({ calculatorId, expression }): Promise<CallToolResult> => {
      const result = evaluateExpression(calculatorId, expression);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored state
      if (result.state) {
        activeCalculators.set(calculatorId, result.state);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          state: result.state,
          result: result.result,
        },
      };
    },
  );

  // Register clear-calculator-history tool (helper for UI)
  server.registerTool(
    "clear-calculator-history",
    {
      title: "Clear Calculator History",
      description: "Clears the calculation history",
      inputSchema: {
        calculatorId: z.string().describe("The calculator session ID"),
      },
    },
    async ({ calculatorId }): Promise<CallToolResult> => {
      const result = clearHistory(calculatorId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored state
      if (result.state) {
        activeCalculators.set(calculatorId, result.state);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          state: result.state,
        },
      };
    },
  );

  // ============================================
  // TODO LIST TOOLS (NEW)
  // ============================================

  // Register open-todo-list tool (main tool with UI)
  server.registerTool(
    "open-todo-list",
    {
      title: "Open Todo List",
      description:
        "Opens an interactive todo list for task management with priorities and filters.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Name for the todo list (default: 'My Tasks')"),
      },
      _meta: {
        [RESOURCE_URI_META_KEY]: todoResource.uri,
      },
    },
    async ({ name }): Promise<CallToolResult> => {
      // Create a new todo list
      const list = createTodoList(name || "My Tasks");

      // Store for later operations
      activeTodoLists.set(list.id, list);

      return {
        content: [
          {
            type: "text",
            text: `Todo list "${list.name}" created. Ready to add tasks.`,
          },
        ],
        structuredContent: {
          list,
          summary: {
            listId: list.id,
            name: list.name,
            itemCount: list.items.length,
          },
        },
      };
    },
  );

  // Register add-todo-item tool (helper for UI)
  server.registerTool(
    "add-todo-item",
    {
      title: "Add Todo Item",
      description: "Adds a new item to the todo list",
      inputSchema: {
        listId: z.string().describe("The todo list ID"),
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description"),
        priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Priority level"),
        dueDate: z
          .string()
          .optional()
          .describe("Due date in YYYY-MM-DD format"),
        tags: z.array(z.string()).optional().describe("Tags for the task"),
      },
    },
    async ({
      listId,
      title,
      description,
      priority,
      dueDate,
      tags,
    }): Promise<CallToolResult> => {
      const result = addTodoItem(listId, {
        title,
        description,
        priority,
        dueDate,
        tags,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored list
      if (result.list) {
        activeTodoLists.set(listId, result.list);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          list: result.list,
          item: result.item,
        },
      };
    },
  );

  // Register complete-todo-item tool (helper for UI)
  server.registerTool(
    "complete-todo-item",
    {
      title: "Complete Todo Item",
      description: "Marks a todo item as completed",
      inputSchema: {
        listId: z.string().describe("The todo list ID"),
        itemId: z.string().describe("The item ID to complete"),
      },
    },
    async ({ listId, itemId }): Promise<CallToolResult> => {
      const result = completeTodoItem(listId, itemId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored list
      if (result.list) {
        activeTodoLists.set(listId, result.list);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          list: result.list,
          item: result.item,
        },
      };
    },
  );

  // Register reopen-todo-item tool (helper for UI)
  server.registerTool(
    "reopen-todo-item",
    {
      title: "Reopen Todo Item",
      description: "Reopens a completed todo item",
      inputSchema: {
        listId: z.string().describe("The todo list ID"),
        itemId: z.string().describe("The item ID to reopen"),
      },
    },
    async ({ listId, itemId }): Promise<CallToolResult> => {
      const result = reopenTodoItem(listId, itemId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored list
      if (result.list) {
        activeTodoLists.set(listId, result.list);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          list: result.list,
          item: result.item,
        },
      };
    },
  );

  // Register delete-todo-item tool (helper for UI)
  server.registerTool(
    "delete-todo-item",
    {
      title: "Delete Todo Item",
      description: "Removes an item from the todo list",
      inputSchema: {
        listId: z.string().describe("The todo list ID"),
        itemId: z.string().describe("The item ID to delete"),
      },
    },
    async ({ listId, itemId }): Promise<CallToolResult> => {
      const result = deleteTodoItem(listId, itemId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored list
      if (result.list) {
        activeTodoLists.set(listId, result.list);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          list: result.list,
          deletedItem: result.item,
        },
      };
    },
  );

  // Register clear-completed-todos tool (helper for UI)
  server.registerTool(
    "clear-completed-todos",
    {
      title: "Clear Completed Todos",
      description: "Removes all completed items from the todo list",
      inputSchema: {
        listId: z.string().describe("The todo list ID"),
      },
    },
    async ({ listId }): Promise<CallToolResult> => {
      const result = clearCompleted(listId);

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { success: false, error: result.message },
        };
      }

      // Update stored list
      if (result.list) {
        activeTodoLists.set(listId, result.list);
      }

      return {
        content: [{ type: "text", text: result.message }],
        structuredContent: {
          success: true,
          list: result.list,
        },
      };
    },
  );

  return server;
};

// ============================================
// EXPRESS SERVER SETUP
// ============================================

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

// Session management for MCP connections
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// MCP POST handler - main entry point for MCP requests
// oxlint-disable-next-line no-async-endpoint-handlers -- MCP handler requires async for transport
const mcpPostHandler = async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Existing session
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session initialization - eventStore enables resumability for MCP Apps
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sid) => {
          console.log(`[MCP] Session initialized: ${sid}`);
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`[MCP] Session closed: ${sid}`);
          delete transports[sid];
        }
      };

      const server = await getServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] Error handling request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

// Routes
// oxlint-disable-next-line no-async-endpoint-handlers -- MCP handler requires async for transport
app.post("/mcp", mcpPostHandler);

// oxlint-disable-next-line no-async-endpoint-handlers -- MCP handler requires async for transport
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// oxlint-disable-next-line no-async-endpoint-handlers -- MCP handler requires async for transport
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("[MCP] Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "ui-protocols-mcp",
    sessions: Object.keys(transports).length,
    apps: ["flights", "hotels", "trading", "kanban", "calculator", "todo"],
  });
});

// Start server
app.listen(PORT, () => {
  console.log(
    `[UI Protocols MCP Server] Running at http://localhost:${PORT}/mcp`,
  );
  console.log(`[Health Check] http://localhost:${PORT}/health`);
  console.log(`[Apps] Flights, Hotels, Trading, Kanban, Calculator, Todo`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[MCP] Shutting down...");
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`[MCP] Error closing session ${sessionId}:`, error);
    }
  }
  process.exit(0);
});
