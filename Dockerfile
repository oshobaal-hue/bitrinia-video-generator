FROM node:20-alpine
RUN apk add --no-cache ffmpeg fontconfig font-dejavu
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 3001
CMD ["node", "server.js"]
