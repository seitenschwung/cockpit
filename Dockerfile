# Demo: static site on unprivileged nginx. Replace it with the project's own image, but keep the
# contract in CLAUDE.md: port 8080, GET /healthz, GET /version.txt (= APP_VERSION), non-root USER.
FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG APP_VERSION=dev
USER root
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
RUN printf '%s' "$APP_VERSION" > /usr/share/nginx/html/version.txt
USER 101
