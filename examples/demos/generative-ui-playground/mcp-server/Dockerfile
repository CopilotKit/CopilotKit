FROM node:20-slim
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (Railway injects PORT)
EXPOSE 3001

# Start server
CMD ["npm", "start"]
