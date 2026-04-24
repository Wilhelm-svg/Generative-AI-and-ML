FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared/package*.json ./shared/
WORKDIR /workspace/shared
RUN npm ci --ignore-scripts
WORKDIR /workspace
COPY shared ./shared
COPY ai-automation-system/package*.json ./ai-automation-system/
WORKDIR /workspace/ai-automation-system
RUN npm ci --ignore-scripts
COPY ai-automation-system/tsconfig.json ./
COPY ai-automation-system/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/ai-automation-system/dist ./dist
COPY ai-automation-system/package*.json ./
RUN npm ci --only=production
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4001/status || exit 1
CMD ["node", "dist/ai-automation-system/src/index.js"]
