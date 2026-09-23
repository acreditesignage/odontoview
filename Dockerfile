FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY apps/web/package*.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY apps/api/package*.json ./
RUN npm install
COPY apps/api ./
COPY --from=web /web/dist ./public
ENV WEB_DIST=/app/public
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh","-c","npx prisma generate && npx prisma db push && node prisma/seed.js && node src/server.js"]
