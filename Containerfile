FROM ghcr.io/jdx/mise:2026.8.16

WORKDIR /app
COPY . .
RUN mise trust
RUN mise deps
RUN mise run capture

COPY *.mp4 .
