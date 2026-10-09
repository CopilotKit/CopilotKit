FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install the exact dependency graph captured in package-lock.json
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# Build Next.js app
RUN npm run build

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
