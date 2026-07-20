# Дашборд ротаций ординаторов · ММКЦ «Коммунарка»

Веб-сайт для заведующих-кураторов: кто из ординаторов сейчас на ротации в подразделении,
кто завершил ротацию (пора подписать логбук), кто придёт следующим. Учебный год 2025/26,
ординаторы 1-го года.

## Состав репозитория

| Путь | Что это |
|---|---|
| `docs/TZ.md` | **Техническое задание** — главный документ, по нему ведётся разработка |
| `docs/prototype-demo.html` | Утверждённый кликабельный прототип интерфейса (открыть в браузере, PIN админки: 1234) |
| `data/seed.json` | Исходные данные: недели, подразделения, кураторы, график ротаций (исправленный) |
| `frontend/` | **Боевой фронтенд** (React + TypeScript + Vite): реальная дата (МСК), данные и правки через API |
| `backend/` | **Backend** (PHP 8.2+, без фреймворков): REST API, MySQL/SQLite через PDO, PIN-авторизация, журнал правок, `notify.php` |
| `frontend-prototype/` | Исходный код прототипа — эталон дизайна, из него развит `frontend/` |

## Статус

- **Готово:** этап 1 в коде — БД + импорт сида, REST API (раздел 7 ТЗ), три экрана + кабинет
  учебной части, PIN и журнал правок, `notify.php` в режиме сухого прогона; GitHub Actions
  деплой (`.github/workflows/deploy.yml`).
- **Осталось:** первичная настройка хостинга по инструкции **[docs/DEPLOY.md](docs/DEPLOY.md)**
  (поддомен, SSL, MySQL, секреты, cron); этап 2 (боевая Telegram-рассылка).

## Локальный запуск

Нужны PHP ≥ 8.2 (pdo_sqlite или pdo_mysql) и Node ≥ 20.

```bash
# 1. Конфиг БД (локально проще всего SQLite)
cp backend/config.sample.php backend/config.php   # раскомментировать sqlite-DSN

# 2. Таблицы, данные из сида, PIN
php backend/scripts/init_db.php --seed=data/seed.json --pin=1234

# 3. Сборка фронтенда
cd frontend && npm install && npm run build && cd ..

# 4. Сервер «всё в одном» (статика + API)
php -S 127.0.0.1:8090 -t frontend/dist backend/scripts/dev-server.php
```

Для работы над фронтендом: `php -S 127.0.0.1:8091 backend/api/index.php` + `npm run dev`
(vite проксирует `/api` на 8091).

Смоук-тест API (временная SQLite-база, боевые данные не трогает):

```bash
bash backend/scripts/smoke_test.sh
```

## Продакшен (кратко; пошагово — [docs/DEPLOY.md](docs/DEPLOY.md))

- Хостинг: виртуальный хостинг Timeweb, поддомен вида `rotation.mmcc-education.ru`.
- БД: **MySQL из панели хостинга** (pdo_sqlite на тарифе недоступен); реквизиты — в
  `rotation-config.php` НАД webroot'ом (см. `backend/config.sample.php`).
- Раскладка: содержимое `frontend/dist/` — в корень поддомена, `backend/api/` — рядом в `api/`.
- Crontab: `php backend/notify.php` по будням в 7:00 МСК (этап 1 — сухой прогон в лог).
- Просмотр публичный; редактирование и кабинет учебной части — по PIN
  (хэш, httpOnly-сессия, не более 5 попыток за 15 минут).
