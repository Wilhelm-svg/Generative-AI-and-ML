FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared/package*.json ./shared/
WORKDIR /workspace/shared
RUN npm ci --ignore-scripts
WORKDIR /workspace
COPY shared ./shared
COPY ai-planning-agent/package*.json ./ai-planning-agent/
WORKDIR /workspace/ai-planning-agent
RUN npm ci --ignore-scripts
COPY ai-planning-agent/tsconfig.json ./
COPY ai-planning-agent/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/ai-planning-agent/dist ./dist
COPY ai-planning-agent/package*.json ./
RUN npm ci --only=production
EXPOSE 4003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4003/status || exit 1
CMD ["node", "dist/ai-planning-agent/src/index.js"]
