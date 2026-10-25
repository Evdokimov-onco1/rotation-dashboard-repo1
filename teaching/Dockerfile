FROM php:8.2-cli
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev \
    && docker-php-ext-install zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public", "dev-router.php"]
