FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY bridge ./bridge
RUN npm run check && npm test && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --from=build --chown=node:node /app/src/ui ./src/ui
COPY --chown=node:node package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/src/main.js"]
