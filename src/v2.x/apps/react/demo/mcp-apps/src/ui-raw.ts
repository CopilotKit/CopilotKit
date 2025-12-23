/**
 * @file App that does NOT depend on Apps SDK runtime.
 *
 * The Raw UI example has no runtime dependency to the Apps SDK
 * but still defines types inline for static type safety.
 *
 * Features a stunning Canvas 2D visualization that responds to MCP events.
 */

import type {
  CallToolRequest,
  CallToolResult,
  JSONRPCMessage,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// Inline Type Definitions (from MCP Apps Extension protocol)
// =============================================================================

interface Implementation {
  name: string;
  version: string;
}

interface McpUiAppCapabilities {
  tools?: { listChanged?: boolean };
  experimental?: Record<string, unknown>;
}

interface McpUiHostCapabilities {
  openLinks?: Record<string, unknown>;
  serverTools?: { listChanged?: boolean };
  serverResources?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

interface McpUiHostContext {
  toolInfo?: { id: string | number; tool: unknown };
  theme?: "light" | "dark" | "system";
  displayMode?: "inline" | "fullscreen" | "pip";
  availableDisplayModes?: string[];
  viewport?: { width: number; height: number; maxHeight?: number; maxWidth?: number };
  locale?: string;
  timeZone?: string;
  userAgent?: string;
  platform?: "web" | "desktop" | "mobile";
  deviceCapabilities?: { touch?: boolean; hover?: boolean };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}

type McpUiInitializeRequest = {
  method: "ui/initialize";
  params: {
    protocolVersion: string;
    appInfo: Implementation;
    appCapabilities: McpUiAppCapabilities;
  };
};

type McpUiInitializeResult = {
  protocolVersion: string;
  hostInfo: Implementation;
  hostCapabilities: McpUiHostCapabilities;
  hostContext?: McpUiHostContext;
};

type McpUiInitializedNotification = {
  method: "ui/notifications/initialized";
  params: Record<string, never>;
};

type McpUiToolInputNotification = {
  method: "ui/notifications/tool-input";
  params: {
    arguments?: Record<string, unknown>;
  };
};

type McpUiToolResultNotification = {
  method: "ui/notifications/tool-result";
  params: {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
};

type McpUiHostContextChangedNotification = {
  method: "ui/notifications/host-context-changed";
  params: Partial<McpUiHostContext>;
};

type McpUiSizeChangeNotification = {
  method: "ui/notifications/size-change";
  params: {
    width: number;
    height: number;
  };
};

type McpUiMessageRequest = {
  method: "ui/message";
  params: {
    role: "user" | "assistant";
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
};

type McpUiMessageResult = {
  isError?: boolean;
};

type McpUiOpenLinkRequest = {
  method: "ui/open-link";
  params: {
    url: string;
  };
};

type McpUiOpenLinkResult = {
  isError?: boolean;
};

// =============================================================================
// Barebones JSON-RPC App Implementation
// =============================================================================

const app = (() => {
  type Sendable = { method: string; params: unknown };

  let nextId = 1;

  return {
    sendRequest<T extends Sendable, Result>({ method, params }: T) {
      const id = nextId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise<Result>((resolve, reject) => {
        window.addEventListener("message", function listener(event) {
          const data: JSONRPCMessage = event.data;
          if (event.data?.id === id) {
            window.removeEventListener("message", listener);
            if (event.data?.result) {
              resolve(event.data.result as Result);
            } else if (event.data?.error) {
              reject(new Error(event.data.error));
            }
          } else {
            reject(new Error(`Unsupported message: ${JSON.stringify(data)}`));
          }
        });
      });
    },
    sendNotification<T extends Sendable>({ method, params }: T) {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    },
    onNotification<T extends Sendable>(
      method: T["method"],
      handler: (params: T["params"]) => void,
    ) {
      window.addEventListener("message", function listener(event) {
        if (event.data?.method === method) {
          handler(event.data.params);
        }
      });
    },
  };
})();

// =============================================================================
// Animation State & Effects
// =============================================================================

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
}

interface SceneState {
  rotationSpeed: number;
  targetRotationSpeed: number;
  scale: number;
  targetScale: number;
  hue: number;
  targetHue: number;
  particles: Particle[];
  statusText: string;
  pulseIntensity: number;
}

const state: SceneState = {
  rotationSpeed: 1,
  targetRotationSpeed: 1,
  scale: 1,
  targetScale: 1,
  hue: 200,
  targetHue: 200,
  particles: [],
  statusText: "Initializing...",
  pulseIntensity: 0,
};

const triggerEffect = (type: "pulse" | "burst" | "color" | "spin") => {
  switch (type) {
    case "pulse":
      state.targetScale = 1.3;
      state.pulseIntensity = 1;
      setTimeout(() => (state.targetScale = 1), 200);
      break;
    case "burst":
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30 + Math.random() * 0.5;
        const speed = 2 + Math.random() * 4;
        state.particles.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          maxLife: 1,
          hue: state.hue + Math.random() * 60 - 30,
          size: 3 + Math.random() * 5,
        });
      }
      break;
    case "color":
      state.targetHue = (state.targetHue + 60 + Math.random() * 60) % 360;
      break;
    case "spin":
      state.targetRotationSpeed = 4;
      setTimeout(() => (state.targetRotationSpeed = 1), 800);
      break;
  }
};

// =============================================================================
// Canvas Visualization
// =============================================================================

function initCanvasScene() {
  const root = document.getElementById("root")!;
  root.innerHTML = "";
  root.style.cssText = `
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%);
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  `;

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `;
  root.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;

  // Status display
  const statusDisplay = document.createElement("div");
  statusDisplay.style.cssText = `
    position: absolute;
    top: 16px;
    left: 16px;
    color: #00ffaa;
    font-size: 12px;
    text-shadow: 0 0 8px #00ffaa;
    max-width: 250px;
    word-wrap: break-word;
    z-index: 10;
  `;
  root.appendChild(statusDisplay);

  // Title
  const title = document.createElement("div");
  title.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    color: #ff00ff;
    font-size: 18px;
    font-weight: bold;
    text-shadow: 0 0 15px #ff00ff, 0 0 30px #ff00ff;
    letter-spacing: 3px;
    z-index: 10;
  `;
  title.textContent = "MCP APPS";
  root.appendChild(title);

  // UI overlay for buttons
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 10;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 95%;
  `;
  root.appendChild(overlay);

  // Background stars
  const stars: Array<{ x: number; y: number; size: number; speed: number }> = [];
  for (let i = 0; i < 100; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.0002 + 0.0001,
    });
  }

  // Hexagon vertices helper
  const getHexagonPoints = (
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
  ) => {
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + rotation;
      points.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }
    return points;
  };

  // Draw icosahedron-like shape (2D projection)
  const drawShape = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation: number,
    hue: number,
    scale: number,
    pulseIntensity: number,
  ) => {
    const r = radius * scale;

    // Outer glow
    const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2);
    gradient.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.3 + pulseIntensity * 0.3})`);
    gradient.addColorStop(0.5, `hsla(${hue}, 100%, 50%, ${0.1 + pulseIntensity * 0.2})`);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);

    // Multiple rotating hexagons
    for (let layer = 0; layer < 3; layer++) {
      const layerRadius = r * (0.6 + layer * 0.25);
      const layerRotation = rotation * (1 + layer * 0.3) + (layer * Math.PI) / 6;
      const opacity = 0.8 - layer * 0.2;
      const hueOffset = layer * 30;

      const points = getHexagonPoints(cx, cy, layerRadius, layerRotation);

      // Fill
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue + hueOffset}, 80%, 50%, ${opacity * 0.3})`;
      ctx.fill();

      // Stroke
      ctx.strokeStyle = `hsla(${hue + hueOffset}, 100%, 70%, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner lines
      ctx.strokeStyle = `hsla(${hue + hueOffset}, 100%, 70%, ${opacity * 0.5})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < points.length; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4 + pulseIntensity * 3, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 100%, 80%, 1)`;
    ctx.fill();
  };

  // Draw orbiting rings
  const drawRings = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    time: number,
    hue: number,
  ) => {
    for (let i = 0; i < 3; i++) {
      const ringRadius = radius * (1.3 + i * 0.3);
      const tilt = 0.3 + i * 0.2;
      const rotationOffset = time * (0.5 + i * 0.2) + (i * Math.PI) / 3;

      ctx.beginPath();
      ctx.ellipse(cx, cy, ringRadius, ringRadius * tilt, rotationOffset, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${(hue + i * 40) % 360}, 100%, 60%, ${0.4 - i * 0.1})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Orbiting dot on ring
      const dotAngle = time * (1 + i * 0.5);
      const dotX = cx + Math.cos(dotAngle) * ringRadius;
      const dotY = cy + Math.sin(dotAngle) * ringRadius * tilt;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${(hue + i * 40) % 360}, 100%, 80%, 0.8)`;
      ctx.fill();
    }
  };

  // Animation variables
  let time = 0;
  let rotation = 0;
  let lastTime = performance.now();

  // Animation loop
  const animate = () => {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    // Update canvas size
    const rect = root.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.2;

    // Clear
    ctx.fillStyle = "rgba(10, 10, 26, 0.1)";
    ctx.fillRect(0, 0, width, height);

    // Smooth state interpolation
    state.rotationSpeed += (state.targetRotationSpeed - state.rotationSpeed) * 0.05;
    state.scale += (state.targetScale - state.scale) * 0.1;
    state.hue += (state.targetHue - state.hue) * 0.02;
    state.pulseIntensity *= 0.95;

    time += delta;
    rotation += delta * state.rotationSpeed;

    // Draw stars
    ctx.fillStyle = "#4488ff";
    for (const star of stars) {
      star.x += star.speed;
      if (star.x > 1) star.x = 0;
      const sx = star.x * width;
      const sy = star.y * height;
      ctx.globalAlpha = 0.3 + Math.sin(time * 2 + star.x * 10) * 0.2;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Draw rings behind
    drawRings(ctx, cx, cy, baseRadius, time, state.hue);

    // Draw main shape
    drawShape(
      ctx,
      cx,
      cy,
      baseRadius,
      rotation,
      state.hue,
      state.scale,
      state.pulseIntensity,
    );

    // Draw particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= delta;

      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }

      const alpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(cx + p.x, cy + p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${alpha})`;
      ctx.fill();
    }

    // Update status
    statusDisplay.textContent = state.statusText;

    requestAnimationFrame(animate);
  };

  animate();

  // Button creator
  const createButton = (
    text: string,
    color: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.cssText = `
      background: linear-gradient(135deg, ${color}22, ${color}44);
      border: 1px solid ${color};
      color: ${color};
      padding: 10px 14px;
      font-family: inherit;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 0 10px ${color}44;
      border-radius: 4px;
      white-space: nowrap;
    `;
    button.onmouseenter = () => {
      button.style.background = `linear-gradient(135deg, ${color}44, ${color}66)`;
      button.style.boxShadow = `0 0 20px ${color}88`;
      button.style.transform = "translateY(-2px)";
    };
    button.onmouseleave = () => {
      button.style.background = `linear-gradient(135deg, ${color}22, ${color}44)`;
      button.style.boxShadow = `0 0 10px ${color}44`;
      button.style.transform = "translateY(0)";
    };
    button.onclick = onClick;
    return button;
  };

  return { overlay, createButton };
}

// =============================================================================
// UI Initialization and Event Handlers
// =============================================================================

window.addEventListener("load", async () => {
  // Initialize Canvas scene
  const { overlay, createButton } = initCanvasScene();

  // Register notification handlers with visual effects
  app.onNotification<McpUiToolInputNotification>(
    "ui/notifications/tool-input",
    async (params) => {
      state.statusText = `⚡ Tool Input: ${JSON.stringify(params.arguments || {}).slice(0, 40)}`;
      triggerEffect("pulse");
      triggerEffect("color");
    },
  );

  app.onNotification<McpUiToolResultNotification>(
    "ui/notifications/tool-result",
    async (params) => {
      const firstContent = params.content?.[0];
      const preview =
        (firstContent && "text" in firstContent ? firstContent.text?.slice(0, 40) : null) ||
        "Result received";
      state.statusText = `✓ Result: ${preview}`;
      triggerEffect("burst");
    },
  );

  app.onNotification<McpUiHostContextChangedNotification>(
    "ui/notifications/host-context-changed",
    async (params) => {
      state.statusText = `🔄 Context: ${Object.keys(params).join(", ")}`;
      triggerEffect("spin");
    },
  );

  // Initialize with host
  try {
    const initializeResult = await app.sendRequest<
      McpUiInitializeRequest,
      McpUiInitializeResult
    >({
      method: "ui/initialize",
      params: {
        appCapabilities: {},
        appInfo: { name: "MCP Visualizer", version: "1.0.0" },
        protocolVersion: "2025-06-18",
      },
    });

    state.statusText = `✓ Connected to ${initializeResult.hostInfo.name}`;
    triggerEffect("burst");

    app.sendNotification<McpUiInitializedNotification>({
      method: "ui/notifications/initialized",
      params: {},
    });

    console.log("Initialized with host info:", initializeResult.hostInfo);
  } catch (e) {
    state.statusText = `⚠ Init: ${e instanceof Error ? e.message : "Error"}`;
  }

  // Size reporting
  new ResizeObserver(() => {
    const rect = (document.body.parentElement ?? document.body).getBoundingClientRect();
    app.sendNotification<McpUiSizeChangeNotification>({
      method: "ui/notifications/size-change",
      params: { width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
    });
  }).observe(document.body);

  // =============================================================================
  // Interactive Buttons
  // =============================================================================

  overlay.appendChild(
    createButton("🌤 Weather", "#00ffaa", async () => {
      state.statusText = "Fetching weather...";
      triggerEffect("spin");
      try {
        const result = await app.sendRequest<CallToolRequest, CallToolResult>({
          method: "tools/call",
          params: { name: "get-weather", arguments: { location: "Tokyo" } },
        });
        const firstContent = result.content?.[0];
        const text =
          (firstContent && "text" in firstContent ? firstContent.text : null) ||
          JSON.stringify(result);
        state.statusText = `🌤 ${text.slice(0, 60)}`;
        triggerEffect("burst");
        triggerEffect("color");
      } catch (e) {
        state.statusText = `❌ ${e instanceof Error ? e.message : "Error"}`;
        triggerEffect("pulse");
      }
    }),
  );

  overlay.appendChild(
    createButton("🛒 Cart", "#ff00ff", () => {
      app.sendNotification<LoggingMessageNotification>({
        method: "notifications/message",
        params: { level: "info", data: "cart-updated" },
      });
      state.statusText = "📤 Sent cart notification";
      triggerEffect("pulse");
      triggerEffect("color");
    }),
  );

  overlay.appendChild(
    createButton("💬 Message", "#00ffff", async () => {
      state.statusText = "Sending message...";
      triggerEffect("spin");
      try {
        const { isError } = await app.sendRequest<McpUiMessageRequest, McpUiMessageResult>({
          method: "ui/message",
          params: {
            role: "user",
            content: [{ type: "text", text: "What is the weather in Tokyo?" }],
          },
        });
        state.statusText = isError ? "❌ Message failed" : "✓ Message sent";
        triggerEffect(isError ? "pulse" : "burst");
      } catch (e) {
        state.statusText = `❌ ${e instanceof Error ? e.message : "Error"}`;
        triggerEffect("pulse");
      }
    }),
  );

  overlay.appendChild(
    createButton("🔗 Link", "#ffff00", async () => {
      state.statusText = "Opening link...";
      try {
        const { isError } = await app.sendRequest<McpUiOpenLinkRequest, McpUiOpenLinkResult>({
          method: "ui/open-link",
          params: { url: "https://www.google.com" },
        });
        state.statusText = isError ? "❌ Link failed" : "✓ Link opened";
        triggerEffect(isError ? "pulse" : "burst");
      } catch (e) {
        state.statusText = `❌ ${e instanceof Error ? e.message : "Error"}`;
        triggerEffect("pulse");
      }
    }),
  );
});
