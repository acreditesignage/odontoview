FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY apps/web/package*.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

# Reuse the already validated OdontoView Mobile ingest engine.
RUN mkdir -p /web/dist/legacy-ingest/js /web/dist/legacy-ingest/vendor/libarchive /web/dist/viewer-libs
COPY js/archive-import.js js/archive-worker.js js/archive-core.js js/dicom-metadata.js /web/dist/legacy-ingest/js/
COPY vendor/libarchive/ /web/dist/legacy-ingest/vendor/libarchive/

# Serve the browser bundles directly. Importing the WADO loader through Vite/Webpack
# triggers automatic publicPath detection failures on Safari.
RUN cp /web/node_modules/cornerstone-core/dist/cornerstone.min.js /web/dist/viewer-libs/cornerstone.min.js  && cp /web/node_modules/dicom-parser/dist/dicomParser.min.js /web/dist/viewer-libs/dicomParser.min.js  && cp /web/node_modules/cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js /web/dist/viewer-libs/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js

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
