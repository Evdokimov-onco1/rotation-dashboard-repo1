# CLAUDE.md

Дашборд ротаций ординаторов ММКЦ «Коммунарка». Главный документ — `docs/TZ.md` (ТЗ 1.3);
если код и ТЗ расходятся, назвать расхождение явно, а не молча «чинить».

## Запуск и проверка

```bash
# backend: SQLite локально, конфиг backend/config.php (см. config.sample.php)
php backend/scripts/init_db.php --reset --seed=data/seed.example.json --current --admin=admin:secret123
php backend/scripts/user.php add --login=disp --password=secret123 --name="Распорядитель" --role=dispatcher --org=mmcc
cd frontend && npm install && npm run build && cd ..
php -S 127.0.0.1:8090 -t frontend/dist backend/scripts/dev-server.php   # сайт + API на 8090

bash backend/scripts/smoke_test.sh        # 55 проверок API на временной БД — должны проходить все
cd frontend && npx tsc -b && npx oxlint src   # типы и линтер фронтенда
php -l backend/api/lib/*.php              # синтаксис PHP
```

Реальные данные (ФИО) — только в `data/private/*.json` (gitignore) и на хостинге в
`~/rotation-private/`. В репозитории — обезличенный `data/seed.example.json`.

## Устройство

- `backend/api/index.php` — роутер; `lib/auth.php` — вход, роли `admin`/`dispatcher`,
  `require_org_access()`; `lib/schedule.php` — чтение года, CRUD блоков и ординаторов, журнал;
  `lib/calendar.php` — `is_rotation_day()` и правка календаря; `lib/windows.php` — окна
  напоминаний (общие для кабинетов и `notify.php`); `lib/generator.php` — генератор ротации;
  `lib/schema.php` — DDL и импорт сида (формат 2).
- `frontend/src/lib/calendar.ts` — зеркало серверной логики дней ротации; `views/*` — экраны;
  справочники хранятся в модуле `data.ts` и заполняются из `GET /api/schedule`.
- Любое изменение окон/дней ротации делать одновременно в PHP и TS.
- Все изменяющие запросы требуют сессии; распорядитель ограничен своей организацией — проверять
  на сервере, клиентские проверки только для удобства.

## Дизайн «Журнал» (выбран заказчиком 15.09.2026)

- Токены в `frontend/src/index.css`: бумага `#FCFCFA`, чернила `#1F2933`, линейка `#D9DEDC`,
  приглушённый `#6B7A84`, красная краска `#B3261E` — только для текущей недели и того, что требует
  подписи. Цвета подразделений — в сидах (`units[].color`), палитра средней светлоты.
- Шрифты: Literata (заголовки, фамилии, курсивные подписи месяцев и групп), Onest (всё остальное,
  табличные цифры). Подключены через Google Fonts в `index.html`.
- Не использовать: капслок-подписи, точки-разделители «·», карточки с одинаковыми тенями,
  эмодзи в интерфейсе. Формулировки от пользователя: «Кабинет заведующего», «График года», «Правка».
- График года (`views/Matrix.tsx`) — журнал с линейками; блоки перетаскиваются и растягиваются
  мышью, тянущийся блок рисуется отдельным слоем поверх таблицы, сохранение сразу через PUT /blocks.

## Соглашения

- Язык интерфейса, комментариев и коммитов — русский.
- Схема БД совместима с MySQL и SQLite (без диалектных конструкций).
- После правок backend прогонять `smoke_test.sh`; после правок фронтенда — `npm run build`.
- Кабинеты (`views/CuratorView.tsx`, `views/ResidentView.tsx`) открываются без входа; постоянные
  ссылки `#c=<curatorId>` и `#r=<residentId>` выбирают вкладку и человека (`App.tsx`).
