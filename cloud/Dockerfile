# esquila-cloud image. Build context is the REPO ROOT:
#   docker build -f cloud/Dockerfile .
# (fly.toml at the repo root is already set up this way.)

# Stage 1: build the EsquilaDB PWA with the repo-root toolchain.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:cloud

# Stage 2: slim runtime with only the cloud service's own deps.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/cloud
COPY cloud/package.json ./
RUN npm install --omit=dev
COPY cloud/ ./
COPY --from=build /app/build-cloud /app/build-cloud
EXPOSE 8080
CMD ["node", "server.js"]
