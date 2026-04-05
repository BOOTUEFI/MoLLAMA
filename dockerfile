# dockerfile
# syntax=docker/dockerfile:1.6

FROM node:20-slim AS frontend
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY src/frontend/package.json src/frontend/package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --silent || npm install --silent

COPY src/frontend/ ./

EXPOSE 22222

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "22222"]


FROM python:3.12-slim AS backend
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY src/backend/requirements.txt ./requirements.txt

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

COPY src/backend/ ./

EXPOSE 11111

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "11111"]