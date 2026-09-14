# Дашборд ротаций ординаторов · ММКЦ «Коммунарка»

Веб-сайт для заведующих-кураторов и учебной части: кто из ординаторов сейчас на ротации в
подразделении, кто завершает (пора подписать логбук), кто придёт следующим; матрица года с
загрузкой подразделений; генератор ротации нового учебного года. Учебный год 2026/27:
ординаторы 1-го и 2-го года ММКЦ «Коммунарка» и НМХЦ им. Пирогова; 2025/26 — архив.

## Состав репозитория

| Путь | Что это |
|---|---|
| `docs/TZ.md` | **Техническое задание 1.3** — главный документ, по нему ведётся разработка |
| `docs/DEPLOY.md` | Пошаговая выкладка на Timeweb |
| `docs/prototype-demo.html` | Утверждённый кликабельный прототип интерфейса (эталон дизайна) |
| `data/seed.example.json` | **Обезличенный** пример сида учебного года (формат 2); реальные данные — вне репозитория |
| `frontend/` | Фронтенд (React + TypeScript + Vite): реальная дата (МСК), данные и правки через API |
| `backend/` | Backend (PHP 8.2+, без фреймворков): REST API, MySQL/SQLite через PDO, вход по паролю, генератор, журнал правок, `notify.php` |
| `frontend-prototype/` | Исходный код прототипа |

## Статус

- **Сделано:** этап 1 (MVP) и этап 2 (учебные годы и архив, организации и распорядители,
  второй год, календарь недель и дней, генератор ротации, вход по логину и паролю, приватные данные).
- **Дальше:** выкладка на хостинг по **[docs/DEPLOY.md](docs/DEPLOY.md)**; этап 3 — Telegram-рассылка.

## Реальные данные (ПДн)

Файлы с реальными ФИО (`2025-26.json`, `2026-27.json`) в git не попадают: локально они лежат в
`data/private/` (каталог в `.gitignore`), на хостинге — в `~/rotation-private/`. Формат тот же,
что у `data/seed.example.json`.

## Локальный запуск

Нужны PHP ≥ 8.2 (pdo_sqlite или pdo_mysql) и Node ≥ 20.

```bash
# 1. Конфиг БД (локально проще всего SQLite)
cp backend/config.sample.php backend/config.php   # раскомментировать sqlite-DSN

# 2. Таблицы, данные, первый администратор
php backend/scripts/init_db.php --seed=data/private/2025-26.json --admin=uchebnaya:ПАРОЛЬ
php backend/scripts/init_db.php --seed=data/private/2026-27.json --current
# (без реальных файлов: --seed=data/seed.example.json --current)

# 3. Распорядители когорт
php backend/scripts/user.php add --login=petukhov  --password=… --name="Петухов Е.А."  --role=dispatcher --org=mmcc
php backend/scripts/user.php add --login=evdokimov --password=… --name="Евдокимов В.И." --role=dispatcher --org=nmhc

# 4. Сборка фронтенда
cd frontend && npm install && npm run build && cd ..

# 5. Сервер «всё в одном» (статика + API)
php -S 127.0.0.1:8090 -t frontend/dist backend/scripts/dev-server.php
```

Для работы над фронтендом: `php -S 127.0.0.1:8091 backend/api/index.php` + `npm run dev`
(vite проксирует `/api` на 8091).

Генератор ротации из консоли (то же, что кнопка в админке):

```bash
php backend/scripts/generate.php --year=2026-27 --org=mmcc --seed=12          # предпросмотр
php backend/scripts/generate.php --year=2026-27 --seed=12 --apply             # записать в БД
```

Смоук-тест API (временная SQLite-база на обезличенном сиде, боевые данные не трогает):

```bash
bash backend/scripts/smoke_test.sh
```

## Продакшен (кратко; пошагово — [docs/DEPLOY.md](docs/DEPLOY.md))

- Хостинг: виртуальный хостинг Timeweb, поддомен вида `rotation.mmcc-education.ru`.
- БД: **MySQL из панели хостинга**; реквизиты — в `rotation-config.php` НАД webroot'ом.
- Раскладка: `frontend/dist/` — в корень поддомена, `backend/api/` — рядом в `api/`; сиды с
  реальными данными — в `~/rotation-private/`.
- Crontab: `php backend/notify.php` по будням в 7:00 МСК (сухой прогон до этапа 3).
- Просмотр публичный; правка — по логину и паролю (учебная часть и распорядители),
  не более 5 попыток за 15 минут.
