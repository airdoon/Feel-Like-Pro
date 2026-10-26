FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js migrate.js bracket.js schema.sql ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["sh", "-c", "node migrate.js && node server.js"]
