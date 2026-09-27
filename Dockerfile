# Stage 1: Build the Next.js Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

COPY frontend/ ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_SUPABASE_URL="https://placeholder-project.supabase.co"
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder"

RUN npm run build

# Stage 2: Final Unified Runtime (Python + Node.js)
FROM python:3.11-slim

# Install system dependencies & Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    build-essential \
    libgdal-dev \
    libgeos-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy Backend Application
COPY backend/ ./backend/

# Copy Frontend Application & Build Artifacts
WORKDIR /app/frontend
COPY frontend/package*.json ./
COPY --from=frontend-builder /app/frontend/.next ./.next
COPY --from=frontend-builder /app/frontend/public ./public
COPY --from=frontend-builder /app/frontend/node_modules ./node_modules
COPY --from=frontend-builder /app/frontend/next.config.ts ./

# Next.js standalone requires static assets inside .next/standalone/
RUN mkdir -p .next/standalone/.next && \
    cp -r .next/static .next/standalone/.next/static 2>/dev/null || true && \
    cp -r public .next/standalone/public 2>/dev/null || true

WORKDIR /app

# Copy Start Script
COPY start.sh ./
RUN chmod +x start.sh

# Environment settings
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
ENV BACKEND_PORT=8000
ENV BACKEND_URL="http://127.0.0.1:8000"
ENV PYTHONUNBUFFERED=1

EXPOSE 3000 8000 10000

CMD ["./start.sh"]
