FROM node:18-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY src/ ./src/

# Create retry queue file if it doesn't exist
RUN touch /app/retry_queue.json

EXPOSE 3000

CMD ["node", "src/index.js"]
