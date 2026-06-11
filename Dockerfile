FROM node:20-alpine

WORKDIR /app

# Instala solo dependencias de produccion (capa cacheable)
COPY package.json ./
RUN npm install --omit=dev

# Copia el codigo
COPY src ./src
COPY scripts ./scripts

# Usuario no-root por seguridad
USER node

CMD ["node", "src/index.js"]
