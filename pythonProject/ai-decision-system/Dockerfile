FROM node:20-alpine AS builder
WORKDIR /workspace
COPY shared/package*.json ./shared/
WORKDIR /workspace/shared
RUN npm ci --ignore-scripts
WORKDIR /workspace
COPY shared ./shared
COPY ai-decision-system/package*.json ./ai-decision-system/
WORKDIR /workspace/ai-decision-system
RUN npm ci --ignore-scripts
COPY ai-decision-system/tsconfig.json ./
COPY ai-decision-system/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/ai-decision-system/dist ./dist
COPY ai-decision-system/package*.json ./
RUN npm ci --only=production
COPY ai-decision-system/frontend ./frontend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/predictions || exit 1
CMD ["node", "dist/ai-decision-system/src/index.js"]
