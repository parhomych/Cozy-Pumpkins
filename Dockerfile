FROM node:22.23.3-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data

EXPOSE 3000
CMD ["npm", "start"]
