# syntax=docker/dockerfile:1.7

FROM ghcr.io/astral-sh/uv:0.9.26@sha256:9a23023be68b2ed09750ae636228e903a54a05ea56ed03a934d00fe9fbeded4b AS uv
FROM python:3.10.19-slim-bookworm@sha256:23f63358922e79a794f71be8f3723c84e5ccca9638af3f74456dc73d6184499e

ARG GRAPHITI_COMMIT=021d3a57d511f21b10adaf7fa923bd5c1fce5e9d
ARG GRAPHITI_SOURCE_SHA256=261607de05c63149574448de3120033dc296709e620ad1524a6aa7b44f816914

LABEL org.opencontainers.image.source="https://github.com/getzep/graphiti" \
      org.opencontainers.image.revision="${GRAPHITI_COMMIT}" \
      org.opencontainers.image.version="0.29.3" \
      org.opencontainers.image.licenses="Apache-2.0"

COPY --from=uv /uv /uvx /usr/local/bin/
ADD --checksum=sha256:${GRAPHITI_SOURCE_SHA256} \
  https://github.com/getzep/graphiti/archive/${GRAPHITI_COMMIT}.tar.gz /tmp/graphiti.tar.gz

RUN python -c "import tarfile; tarfile.open('/tmp/graphiti.tar.gz').extractall('/tmp/source')" \
    && mkdir -p /app \
    && cp -a "/tmp/source/graphiti-${GRAPHITI_COMMIT}/mcp_server" /app/mcp \
    && mkdir -p /usr/share/licenses/graphiti \
    && cp "/tmp/source/graphiti-${GRAPHITI_COMMIT}/LICENSE" /usr/share/licenses/graphiti/LICENSE \
    && rm -rf /tmp/graphiti.tar.gz /tmp/source \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin graphiti \
    && chown -R graphiti:graphiti /app

WORKDIR /app/mcp
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    GRAPHITI_TELEMETRY_ENABLED=false

RUN uv sync --frozen --no-group dev \
    && .venv/bin/python -c "from importlib.metadata import version; assert version('graphiti-core') == '0.29.2'"

COPY --chown=graphiti:graphiti ops/graphiti/config.yaml /app/mcp/config/config.yaml

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["/app/mcp/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["/app/mcp/.venv/bin/python", "main.py"]
