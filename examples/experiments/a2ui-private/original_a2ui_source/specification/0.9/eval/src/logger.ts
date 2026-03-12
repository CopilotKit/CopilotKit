import * as winston from "winston";
import * as path from "path";

let fileTransport: winston.transport | null = null;

const consoleTransport = new winston.transports.Console({
  level: "info", // Default to info, can be updated later
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => {
      // Clear the current line (where progress bar might be) before logging
      // \r clears the line, \x1b[K clears from cursor to end of line
      return `\r\x1b[K${timestamp} [${level}]: ${message}`;
    })
  ),
});

// Create a default logger instance that logs to console only initially
export const logger = winston.createLogger({
  level: "debug", // Allow all logs to flow through (transports can filter)
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [consoleTransport],
});

export function setupLogger(outputDir: string | undefined, logLevel: string) {
  // Ensure the global level allows debug logs so they reach the file transport
  logger.level = "debug";

  // Update Console transport level to match user preference directly
  consoleTransport.level = logLevel;

  if (fileTransport) {
    logger.remove(fileTransport);
    fileTransport = null;
  }

  if (outputDir) {
    fileTransport = new winston.transports.File({
      filename: path.join(outputDir, "output.log"),
      level: "debug", // Always capture everything in the file
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    });

    logger.add(fileTransport);
  }
}
