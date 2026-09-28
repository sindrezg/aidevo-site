FROM node:22-slim
WORKDIR /app
COPY . .
EXPOSE 8050
CMD ["node", "server.js"]
