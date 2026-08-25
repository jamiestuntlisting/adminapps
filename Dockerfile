FROM node:22-alpine
WORKDIR /app
COPY server.js seed.json ./
COPY public ./public
ENV DATA_DIR=/data PORT=8090
VOLUME /data
EXPOSE 8090
CMD ["node", "server.js"]
