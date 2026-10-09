# Optional: for a VPS. Hostinger Business/Cloud plans do NOT need Docker (see INSTALL.md).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "server.js"]
