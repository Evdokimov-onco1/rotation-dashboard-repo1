# Первичная настройка и деплой на Timeweb

Пошаговая инструкция по разделу 9 ТЗ 1.3. Делается **один раз**; дальше любое обновление —
это просто пуш в `main` (GitHub Actions соберёт и выложит сам, данные в БД не трогаются).

В примерах:
- `ЛОГИН` — логин хостинга Timeweb (вида `cw12345`);
- поддомен — `rotation.mmcc-education.ru` (финальное имя — на ваше усмотрение);
- пути на хостинге Timeweb обычно выглядят как `/home/c/ЛОГИН/...` — точные значения
  видно в панели и по SSH командой `pwd`.

Что получится в итоге:

```
/home/c/ЛОГИН/
├── rotation.mmcc-education.ru/
│   └── public_html/            ← webroot: статика фронтенда + api/  (заливает Actions)
├── rotation-backend/            ← backend/ и data/ вне webroot       (заливает Actions)
│   ├── backend/  (notify.php, scripts/, api/…)
│   └── data/     (seed.example.json — обезличенный пример)
├── rotation-private/            ← сиды с РЕАЛЬНЫМИ данными (кладёте вручную, в git их нет)
│   ├── 2025-26.json
│   └── 2026-27.json
├── rotation-config.php          ← реквизиты MySQL (создаёте вручную, в git не попадает)
└── backups/                     ← еженедельные дампы БД (cron)
```

---

## 1. Поддомен, PHP и SSL

1. Панель Timeweb → **«Домены и поддомены»** → у домена `mmcc-education.ru` нажать
   **«Добавить поддомен»** → имя `rotation`. Каталог сайта создастся автоматически.
2. Раздел **«Сайты»** (или настройки поддомена) → версия PHP — **8.2** или новее.
3. Раздел **«SSL-сертификаты»** → выпустить бесплатный **Let's Encrypt** для
   `rotation.mmcc-education.ru`. Редирект HTTP→HTTPS делает `.htaccess` из деплоя.

## 2. База данных MySQL

1. Панель → **«Базы данных MySQL»** → **«Создать базу»**: имя вида `ЛОГИН_rotation`,
   пользователь и пароль запишите.
2. Хост БД — `localhost` (стандарт для Timeweb).

## 3. Файл с реквизитами БД (вне webroot)

Через **файловый менеджер** панели (или по SSH) создайте файл
`/home/c/ЛОГИН/rotation-config.php` — на уровень ВЫШЕ каталога поддомена:

```php
<?php
return [
    'dsn'     => 'mysql:host=localhost;dbname=ЛОГИН_rotation;charset=utf8mb4',
    'db_user' => 'ЛОГИН_rotation',
    'db_pass' => 'ПАРОЛЬ_ИЗ_ШАГА_2',
    'notify_log' => '/home/c/ЛОГИН/rotation-backend/notify.log',
];
```

Backend ищет конфиг сам: для веб-запросов — `rotation-config.php` в каталоге поддомена
(`/home/c/ЛОГИН/rotation.mmcc-education.ru/`) или в домашнем каталоге (`/home/c/ЛОГИН/`);
для консольных скриптов и cron путь передаётся переменной `ROTATION_CONFIG`. Образец —
`backend/config.sample.php`.

## 4. SSH-доступ и ключ для деплоя

1. Панель → **«SSH»** → включить SSH-доступ, узнать хост и порт (обычно `ЛОГИН.timeweb.ru`, 22).
2. На **своём компьютере** сгенерируйте пару ключей (Enter на все вопросы):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/timeweb_deploy -N ""
   ```
3. Добавьте **публичный** ключ на хостинг:
   ```bash
   ssh-copy-id -i ~/.ssh/timeweb_deploy.pub ЛОГИН@ЛОГИН.timeweb.ru
   ```
4. Проверьте вход без пароля: `ssh -i ~/.ssh/timeweb_deploy ЛОГИН@ЛОГИН.timeweb.ru` →
   `pwd` покажет домашний каталог. Там же создайте каталоги:
   ```bash
   mkdir -p ~/rotation-backend ~/rotation-private ~/backups
   ```

## 5. Сиды с реальными данными

Скопируйте на хостинг файлы `2025-26.json` и `2026-27.json` (лежат у вас локально в
`data/private/`, в репозитории их нет) в `~/rotation-private/` — через файловый менеджер
панели или `scp`:

```bash
scp -i ~/.ssh/timeweb_deploy data/private/*.json ЛОГИН@ЛОГИН.timeweb.ru:~/rotation-private/
```

## 6. Секреты GitHub

GitHub → репозиторий → **Settings → Secrets and variables → Actions →
New repository secret**. Нужны шесть секретов:

| Секрет | Значение (пример) |
|---|---|
| `DEPLOY_HOST` | `ЛОГИН.timeweb.ru` |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_USER` | `ЛОГИН` |
| `DEPLOY_SSH_KEY` | содержимое **приватного** файла `~/.ssh/timeweb_deploy` целиком, со строками BEGIN/END |
| `DEPLOY_WEBROOT` | `/home/c/ЛОГИН/rotation.mmcc-education.ru/public_html` |
| `DEPLOY_BACKEND_DIR` | `/home/c/ЛОГИН/rotation-backend` |

⚠️ Деплой выполняет `rsync --delete`: содержимое webroot'а и `rotation-backend` приводится
в точное соответствие сборке — ничего постороннего в эти каталоги руками не кладите
(`rotation-private/` и `rotation-config.php` лежат отдельно и не затрагиваются).

## 7. Первый деплой

GitHub → вкладка **Actions** → workflow **Deploy** → **Run workflow**, либо смержить PR в `main`.
Зелёная галочка = статика и API на хостинге. Сайт уже откроется, но покажет ошибку БД — она
пуста, идём дальше.

## 8. Инициализация БД, администратор и распорядители

По SSH на хостинге (пароли придумайте свои, не короче 6 символов):

```bash
cd ~/rotation-backend
export ROTATION_CONFIG=~/rotation-config.php

# архив 2025/26 + первый администратор (учебная часть)
php backend/scripts/init_db.php --seed=$HOME/rotation-private/2025-26.json --admin=uchebnaya:ПАРОЛЬ_УЧ

# текущий год 2026/27
php backend/scripts/init_db.php --seed=$HOME/rotation-private/2026-27.json --current

# распорядители когорт
php backend/scripts/user.php add --login=petukhov  --password=ПАРОЛЬ_1 --name="Петухов Е.А."  --role=dispatcher --org=mmcc
php backend/scripts/user.php add --login=evdokimov --password=ПАРОЛЬ_2 --name="Евдокимов В.И." --role=dispatcher --org=nmhc
php backend/scripts/user.php list
```

Дальше пользователей можно заводить и менять пароли в админке сайта (раздел «Пользователи»).

## 9. Crontab

Панель → **«Crontab»** → добавить две задачи (время сервера Timeweb — московское):

**Напоминания кураторам — будни, 7:00** (до этапа 3 — сухой прогон в `notify.log`):

```
0 7 * * 1-5  ROTATION_CONFIG=/home/c/ЛОГИН/rotation-config.php php /home/c/ЛОГИН/rotation-backend/backend/notify.php
```

**Резервная копия БД — воскресенье, 3:00** (хранится 8 недель):

```
0 3 * * 0  mysqldump -uЛОГИН_rotation -p'ПАРОЛЬ' ЛОГИН_rotation | gzip > /home/c/ЛОГИН/backups/rotation-$(date +\%F).sql.gz && find /home/c/ЛОГИН/backups -name 'rotation-*.sql.gz' -mtime +56 -delete
```

Восстановление из копии: `zcat rotation-ДАТА.sql.gz | mysql -u... -p... ЛОГИН_rotation`.

## 10. Проверка (критерии приёмки этапа 2)

1. `https://rotation.mmcc-education.ru` открывается по HTTPS; в шапке «2026/27, текущий год»,
   переключатель показывает архив 2025/26 с полным графиком.
2. Матрица: четыре группы (ММКЦ 1 год, ММКЦ 2 год, НМХЦ 1 год, НМХЦ 2 год), 29 строк,
   под ней таблица загрузки.
3. Кабинет заведующего: выбрать заведующего — секции «сейчас / придут / завершились недавно».
   Кабинет ординатора: выбрать ординатора — план на год; ссылка `…/#r=<id>` открывает его сразу.
4. Админка: без входа редактирование недоступно (в т.ч. прямым запросом к API); после входа
   распорядителем НМХЦ чужой блок открывается только на просмотр.
5. Генератор: «Сгенерировать» → предпросмотр → «Применить»; блоки появились в матрице.
6. Календарь: выключить неделю или добавить исключение по дню — меняется «последний день»
   в кабинетах.
7. Правка видна с другого компьютера и после перезагрузки; в «Журнале правок» есть автор.
8. На следующее утро в `~/rotation-backend/notify.log` появилась запись сухого прогона.

## 11. Эксплуатация

- **Обновление кода:** пуш в `main` → Actions развернёт сам. БД не затрагивается.
- **Правка данных года «сбоку»** (например, исправленный сид): положить файл в
  `~/rotation-private/`, затем `init_db.php --seed=… --force` (перед этим копия БД — шаг 9).
  Внимание: `--force` заменяет ординаторов и блоки этого года, правки из админки за год
  пропадут — обычно проще править в админке.
- **Новый учебный год:** новый сид-файл → `init_db.php --seed=… --current`. Прошлые годы
  остаются в базе как архив.
- **Смена схемы БД** (если в обновлении сказано «нужен --reset»): копия БД → `init_db.php
  --reset` → импорт сидов заново → пользователи заново.
- **Этап 3 (Telegram):** создать бота у @BotFather, токен записать в `settings`
  (`telegram_bot_token`), привязать `telegram_chat_id` кураторам — код рассылки уже боевой.
- **Запасной путь без Actions:** по SSH `git clone` репозитория и ручной `rsync` тех же
  каталогов (см. `.github/workflows/deploy.yml`).
