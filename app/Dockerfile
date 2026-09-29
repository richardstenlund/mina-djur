FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads && chown -R node:node uploads

ENV NODE_ENV=production
EXPOSE 3000

USER node

CMD ["node", "server.js"]
