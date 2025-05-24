FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm install
RUN npm install -g typescript
RUN tsc

CMD ["node", "build/index.js"]
