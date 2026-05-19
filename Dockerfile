FROM node:20-slim

# Install Chromium + all required libs
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install

# Install and build React client
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Copy server source
COPY server/ ./server/

EXPOSE 5000
CMD ["node", "server/server.js"]
