#!/usr/bin/env bash
# Смоук-тест API на SQLite + встроенном php-сервере (БД в temp-каталоге,
# боевые данные не трогает). Запуск из корня репозитория:
#   bash backend/scripts/smoke_test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
PORT="${SMOKE_PORT:-8091}"
BASE="http://127.0.0.1:$PORT/api"
JAR="$TMP/cookies.txt"
JAR2="$TMP/cookies2.txt"
PASS=0; FAIL=0

cat > "$TMP/config.php" <<PHP
<?php return ['dsn' => 'sqlite:$TMP/rotation.db', 'notify_log' => '$TMP/notify.log'];
PHP
export ROTATION_CONFIG="$TMP/config.php"

php "$ROOT/backend/scripts/init_db.php" --seed="$ROOT/data/seed.json" --pin=4321 --force >/dev/null \
  || { echo "init_db.php завершился с ошибкой"; exit 1; }

php -S "127.0.0.1:$PORT" "$ROOT/backend/api/index.php" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 0.7

req() { # method path [json-body] [cookie-jar]; результат в CODE/BODY
  local method=$1 path=$2 data=${3:-} jar=${4:-$JAR} out
  out=$(curl -sS -X "$method" "$BASE$path" \
        -H 'Content-Type: application/json' \
        ${data:+--data "$data"} \
        -b "$jar" -c "$jar" -w $'\n%{http_code}')
  CODE=$(tail -n1 <<<"$out")
  BODY=$(sed '$d' <<<"$out")
}

check() { # имя ожидаемый_код [подстрока_в_ответе]
  local name=$1 want=$2 pat=${3:-}
  if [[ "$CODE" != "$want" ]]; then
    echo "FAIL $name: код $CODE (ожидался $want): $BODY"; FAIL=$((FAIL+1)); return
  fi
  if [[ -n "$pat" ]] && ! grep -qF "$pat" <<<"$BODY"; then
    echo "FAIL $name: в ответе нет «$pat»: $BODY"; FAIL=$((FAIL+1)); return
  fi
  echo "ok   $name"; PASS=$((PASS+1))
}

# ── публичное чтение ──
req GET /schedule
check "GET /schedule" 200 '"today"'
N=$(grep -o '"residentId"' <<<"$BODY" | wc -l)
if [[ "$N" == "58" ]]; then echo "ok   в графике 58 блоков"; PASS=$((PASS+1));
else echo "FAIL блоков в графике: $N (ожидалось 58)"; FAIL=$((FAIL+1)); fi

req GET /curators/levitskiy/dashboard
check "GET dashboard куратора" 200 '"maybe"'
req GET /curators/nosuch/dashboard
check "dashboard неизвестного куратора" 404 "не найден"

# ── без авторизации менять нельзя ──
req POST /blocks '{"residentId":"buh","unitId":"ooplt","from":35,"to":35}'
check "POST /blocks без сессии" 401 "PIN"
req PUT /blocks/b01/curator '{"curatorId":"umyarov"}'
check "PUT curator без сессии" 401 "PIN"
req GET /audit
check "GET /audit без сессии" 401 "PIN"

# ── авторизация ──
req POST /auth/pin '{"pin":"0000"}'
check "неверный PIN" 401 "Неверный PIN"
req POST /auth/pin '{"pin":"4321"}'
check "верный PIN" 200 '"ok"'
req GET /auth/status
check "статус после входа" 200 '"authorized":true'

# ── валидация ──
req POST /blocks '{"residentId":"buh","unitId":"oo1","from":5,"to":7}'
check "пересечение блоков отклонено" 422 "Пересекается"
req POST /blocks '{"residentId":"buh","unitId":"oo1","from":7,"to":5}'
check "from > to отклонено" 422 "позже"
req POST /blocks '{"residentId":"buh","unitId":"oo1","from":35,"to":36}'
check "несуществующая неделя отклонена" 422 "календаре"

# ── CRUD блока ──
req POST /blocks '{"residentId":"buh","unitId":"ooplt","from":35,"to":35,"comment":"тест"}'
check "создание блока" 201 '"curatorId":"fedorinov"'   # auto-куратор проставлен
BID=$(grep -o '"id":"[^"]*"' <<<"$BODY" | head -1 | cut -d'"' -f4)
req PUT "/blocks/$BID" '{"residentId":"buh","unitId":"iuzi","from":35,"to":35}'
check "правка блока" 200 '"curatorId":"lummer"'
req PUT /blocks/b01/curator '{"curatorId":"umyarov"}'
check "назначение куратора manual-блоку" 200 '"curatorId":"umyarov"'
req PUT /blocks/b01/curator '{"curatorId":"ronzin"}'
check "куратор не из кандидатов отклонён" 422 "кандидаты"
req PUT /blocks/b01/curator '{"curatorId":null}'
check "снятие куратора" 200 '"curatorId":null'
req DELETE "/blocks/$BID"
check "удаление блока" 200 '"ok"'

# ── журнал правок ──
req GET /audit
check "журнал: создание" 200 'block_create'
check "журнал: назначение куратора" 200 'curator_assign'
check "журнал: удаление" 200 'block_delete'

# ── выход ──
req POST /auth/logout
check "выход" 200 '"ok"'
req POST /blocks '{"residentId":"buh","unitId":"ooplt","from":35,"to":35}'
check "после выхода менять нельзя" 401 "PIN"

# ── ограничение перебора PIN (отдельная cookie-сессия, тот же IP) ──
for i in 1 2 3 4 5; do req POST /auth/pin '{"pin":"9999"}' "" "$JAR2"; done
req POST /auth/pin '{"pin":"4321"}' "" "$JAR2"
check "6-я попытка блокируется (429)" 429 "попыток"

# ── notify.php: сухой прогон на фиксированную дату ──
# 11.12.2025 (чт) — предпоследний рабочий день недели 14: у Левицкого завершается
# ротация Бухуровой (нед. 11–14), у администратора — срочные manual-блоки.
NOTIFY_OUT=$(php "$ROOT/backend/notify.php" 2025-12-11)
for pat in "DRY-RUN" "Левицкий" "Завершается ротация" "Бухурова" "администратору"; do
  if grep -qF "$pat" <<<"$NOTIFY_OUT"; then echo "ok   notify: есть «$pat»"; PASS=$((PASS+1));
  else echo "FAIL notify: нет «$pat»"; FAIL=$((FAIL+1)); fi
done
if php "$ROOT/backend/notify.php" 2025-12-13 | grep -qF "выходной"; then
  echo "ok   notify: суббота — рассылки нет"; PASS=$((PASS+1))
else echo "FAIL notify: суббота должна пропускаться"; FAIL=$((FAIL+1)); fi

echo "──────────────────────────────"
echo "Итог: пройдено $PASS, провалено $FAIL"
[[ $FAIL -eq 0 ]]
