# ============================================================================
# Order-to-Audit ERP — Production Multi-Stage Dockerfile
# ============================================================================

# Stage 1: Build Frontend Single Page Application
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Monolith Runtime
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install backend production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source code and migrations
COPY backend/ ./backend/
COPY database/ ./database/

# Copy built frontend assets from stage 1 into production directory
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 5000

WORKDIR /app/backend
CMD ["node", "src/server.js"]
