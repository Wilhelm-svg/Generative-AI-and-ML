FROM node:20-alpine AS builder
WORKDIR /workspace
# Copy shared library and project files (build context = workspace root)
COPY shared/package*.json ./shared/
WORKDIR /workspace/shared
RUN npm ci --ignore-scripts
WORKDIR /workspace
COPY shared ./shared
COPY enterprise-ai-copilot/package*.json ./enterprise-ai-copilot/
WORKDIR /workspace/enterprise-ai-copilot
RUN npm ci --ignore-scripts
COPY enterprise-ai-copilot/tsconfig.json ./
COPY enterprise-ai-copilot/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/enterprise-ai-copilot/dist ./dist
COPY enterprise-ai-copilot/package*.json ./
RUN npm ci --only=production
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4002/status || exit 1
CMD ["node", "dist/enterprise-ai-copilot/src/index.js"]
