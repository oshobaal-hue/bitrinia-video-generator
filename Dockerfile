FROM node:20-bookworm-slim

# Instalar ffmpeg (necesario para generar videos)
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar dependencias
COPY package.json package-lock.json* ./
RUN npm install --production

# Copiar código
COPY server.js ./

# Puerto Railway
EXPOSE 3001

CMD ["node", "server.js"]
