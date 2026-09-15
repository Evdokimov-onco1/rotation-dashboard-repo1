#!/usr/bin/env bash
# Настройка хостинга Timeweb целиком из веб-консоли панели (ничего ставить на свой
# компьютер не нужно). Два запуска:
#
#   bash setup.sh prepare   — ДО первого деплоя: папки, файл с реквизитами БД,
#                             ключ для робота GitHub, значения секретов
#   bash setup.sh init      — ПОСЛЕ первого деплоя: заполнить базу, создать
#                             пользователей, показать строки для Crontab
#
# Скачать на хостинг:
#   curl -fsSLo setup.sh https://raw.githubusercontent.com/Evdokimov-onco1/rotation-dashboard-repo1/main/deploy/server-setup.sh
set -euo pipefail

mode=${1:-prepare}
H=$HOME
CFG="$H/rotation-config.php"
KEY="$H/.ssh/rotation_deploy"
line() { printf '%s\n' "──────────────────────────────────────────────────────────────"; }

case "$mode" in

prepare)
  echo "Подготовка хостинга. Ответьте на четыре вопроса."
  read -rp "Поддомен сайта (например rotation.mmcc-education.ru): " SUB
  WEBROOT="$H/$SUB/public_html"
  if [ ! -d "$WEBROOT" ]; then
    echo "Папка $WEBROOT не найдена. Сначала создайте поддомен в панели (раздел «Домены и поддомены»)."
    exit 1
  fi
  read -rp "Имя базы MySQL (из раздела «Базы данных MySQL»): " DBNAME
  read -rp "Пользователь базы (обычно совпадает с именем базы) [$DBNAME]: " DBUSER
  DBUSER=${DBUSER:-$DBNAME}
  read -rsp "Пароль базы (при вводе не отображается): " DBPASS; echo

  mkdir -p "$H/rotation-backend" "$H/rotation-private" "$H/backups" "$H/.ssh"
  chmod 700 "$H/.ssh"

  # файл с реквизитами БД — вне webroot, недоступен по адресу сайта
  DBNAME="$DBNAME" DBUSER="$DBUSER" DBPASS="$DBPASS" LOG="$H/rotation-backend/notify.log" \
  php -r '
    $c = ["dsn" => "mysql:host=localhost;dbname=" . getenv("DBNAME") . ";charset=utf8mb4",
          "db_user" => getenv("DBUSER"), "db_pass" => getenv("DBPASS"), "notify_log" => getenv("LOG")];
    file_put_contents($argv[1], "<?php\nreturn " . var_export($c, true) . ";\n");
  ' "$CFG"
  chmod 600 "$CFG"

  # проверка, что база отвечает
  if ! php -r '
    $c = require $argv[1];
    try { new PDO($c["dsn"], $c["db_user"], $c["db_pass"]); echo "База MySQL отвечает.\n"; }
    catch (Throwable $e) { echo "Ошибка подключения: " . $e->getMessage() . "\n"; exit(1); }
  ' "$CFG"; then
    echo "К базе подключиться не удалось. Проверьте имя, пользователя и пароль в панели и запустите снова."
    exit 1
  fi

  # ключ для робота GitHub Actions: приватная часть уйдёт в секрет, публичная — в authorized_keys
  if [ ! -f "$KEY" ]; then
    ssh-keygen -q -t ed25519 -N "" -f "$KEY" -C "rotation-deploy"
  fi
  touch "$H/.ssh/authorized_keys"
  grep -qF "$(cat "$KEY.pub")" "$H/.ssh/authorized_keys" || cat "$KEY.pub" >> "$H/.ssh/authorized_keys"
  chmod 600 "$H/.ssh/authorized_keys"

  USER_NAME=$(whoami)
  line
  echo "Готово. Теперь в GitHub: Settings → Secrets and variables → Actions → New repository secret."
  echo "Заведите шесть секретов, значения копируйте отсюда:"
  line
  printf '%-20s %s\n' "DEPLOY_HOST"        "$USER_NAME.timeweb.ru"
  printf '%-20s %s\n' "DEPLOY_PORT"        "22"
  printf '%-20s %s\n' "DEPLOY_USER"        "$USER_NAME"
  printf '%-20s %s\n' "DEPLOY_WEBROOT"     "$WEBROOT"
  printf '%-20s %s\n' "DEPLOY_BACKEND_DIR" "$H/rotation-backend"
  printf '%-20s %s\n' "DEPLOY_SSH_KEY"     "весь текст ниже, от строки BEGIN до строки END включительно:"
  line
  cat "$KEY"
  line
  echo "Дальше: загрузите файлы 2025-26.json и 2026-27.json в папку rotation-private"
  echo "(панель → «Файловый менеджер»), затем запустите деплой в GitHub (слить PR в main"
  echo "или Actions → Deploy → Run workflow). Когда деплой зелёный — bash setup.sh init"
  ;;

init)
  export ROTATION_CONFIG="$CFG"
  if [ ! -f "$CFG" ]; then echo "Нет $CFG. Сначала: bash setup.sh prepare"; exit 1; fi
  if [ ! -f "$H/rotation-backend/backend/scripts/init_db.php" ]; then
    echo "Код ещё не выложен на хостинг. Сначала запустите деплой в GitHub Actions и дождитесь зелёной галочки."
    exit 1
  fi
  for f in 2025-26.json 2026-27.json; do
    if [ ! -f "$H/rotation-private/$f" ]; then
      echo "Нет файла rotation-private/$f. Загрузите его через «Файловый менеджер» в панели."
      exit 1
    fi
  done
  cd "$H/rotation-backend"

  echo "Придумайте пароли (не короче 6 символов, при вводе не отображаются)."
  read -rsp "Пароль администратора, логин uchebnaya: " P_ADMIN; echo
  read -rsp "Пароль распорядителя ММКЦ, логин petukhov: " P_MMCC; echo
  read -rsp "Пароль распорядителя НМХЦ, логин evdokimov: " P_NMHC; echo

  php backend/scripts/init_db.php --seed="$H/rotation-private/2025-26.json" --admin="uchebnaya:$P_ADMIN"
  php backend/scripts/init_db.php --seed="$H/rotation-private/2026-27.json" --current
  php backend/scripts/user.php add --login=petukhov  --password="$P_MMCC" --name="Петухов Е.А."  --role=dispatcher --org=mmcc  || true
  php backend/scripts/user.php add --login=evdokimov --password="$P_NMHC" --name="Евдокимов В.И." --role=dispatcher --org=nmhc || true
  php backend/scripts/user.php list

  # реквизиты БД для строки бэкапа
  DBNAME=$(php -r '$c = require $argv[1]; preg_match("/dbname=([^;]+)/", $c["dsn"], $m); echo $m[1] ?? "";' "$CFG")
  DBUSER=$(php -r '$c = require $argv[1]; echo $c["db_user"];' "$CFG")
  line
  echo "База заполнена. Откройте сайт и проверьте график."
  echo "Последний шаг — панель → «Crontab» → добавить две задачи (скопируйте строки целиком):"
  line
  echo "Напоминания кураторам, будни 7:00:"
  echo "0 7 * * 1-5 ROTATION_CONFIG=$CFG php $H/rotation-backend/backend/notify.php"
  echo
  echo "Резервная копия базы, воскресенье 3:00 (вместо ПАРОЛЬ подставьте пароль базы):"
  echo "0 3 * * 0 mysqldump -u$DBUSER -p'ПАРОЛЬ' $DBNAME | gzip > $H/backups/rotation-\$(date +\\%F).sql.gz && find $H/backups -name 'rotation-*.sql.gz' -mtime +56 -delete"
  line
  ;;

*)
  echo "Использование: bash setup.sh prepare | init"
  exit 1
  ;;
esac
