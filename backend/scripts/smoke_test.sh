#!/usr/bin/env bash
# Смоук-тест API на SQLite + встроенном php-сервере (БД в temp-каталоге,
# боевые данные не трогает). Использует обезличенный data/seed.example.json.
# Запуск из корня репозитория:
#   bash backend/scripts/smoke_test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
PORT="${SMOKE_PORT:-8091}"
BASE="http://127.0.0.1:$PORT/api"
JAR="$TMP/cookies.txt"
JAR2="$TMP/cookies2.txt"
JAR3="$TMP/cookies3.txt"
PASS=0; FAIL=0

cat > "$TMP/config.php" <<PHP
<?php return ['dsn' => 'sqlite:$TMP/rotation.db', 'notify_log' => '$TMP/notify.log'];
PHP
export ROTATION_CONFIG="$TMP/config.php"

php "$ROOT/backend/scripts/init_db.php" --seed="$ROOT/data/seed.example.json" --current --admin=admin:secret123 >/dev/null \
  || { echo "init_db.php завершился с ошибкой"; exit 1; }
php "$ROOT/backend/scripts/user.php" add --login=disp --password=secret123 --name="Распорядитель" --role=dispatcher --org=mmcc >/dev/null \
  || { echo "user.php завершился с ошибкой"; exit 1; }

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
    echo "FAIL $name: код $CODE (ожидался $want): ${BODY:0:300}"; FAIL=$((FAIL+1)); return
  fi
  if [[ -n "$pat" ]] && ! grep -qF "$pat" <<<"$BODY"; then
    echo "FAIL $name: в ответе нет «$pat»: ${BODY:0:300}"; FAIL=$((FAIL+1)); return
  fi
  echo "ok   $name"; PASS=$((PASS+1))
}

# ── публичное чтение ──
req GET /schedule
check "GET /schedule" 200 '"today"'
check "в ответе учебный год" 200 '"year":"2025-26"'
check "в ответе организации" 200 '"organizations"'
check "в ответе порог загрузки" 200 '"capacityThreshold":3'
N=$(grep -o '"residentId"' <<<"$BODY" | wc -l)
if [[ "$N" == "58" ]]; then echo "ok   в графике 58 блоков"; PASS=$((PASS+1));
else echo "FAIL блоков в графике: $N (ожидалось 58)"; FAIL=$((FAIL+1)); fi
req GET "/schedule?year=nosuch"
check "неизвестный год" 404 "не найден"

req GET /curators/levitskiy/dashboard
check "GET dashboard куратора" 200 '"maybe"'
req GET /curators/nosuch/dashboard
check "dashboard неизвестного куратора" 404 "не найден"

# ── без авторизации менять нельзя ──
req POST /blocks '{"residentId":"buh","unitId":"ooplt","from":35,"to":35}'
check "POST /blocks без сессии" 401 "авторизация"
req PUT /blocks/b01/curator '{"curatorId":"umyarov"}'
check "PUT curator без сессии" 401 "авторизация"
req GET /audit
check "GET /audit без сессии" 401 "авторизация"
req POST /generate '{}'
check "POST /generate без сессии" 401 "авторизация"

# ── вход ──
req POST /auth/login '{"login":"admin","password":"wrong"}'
check "неверный пароль" 401 "Неверный логин или пароль"
req POST /auth/login '{"login":"admin","password":"secret123"}'
check "вход администратора" 200 '"role":"admin"'
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

# ── ординаторы ──
req POST /residents '{"fio":"Тестов Тест Тестович","orgId":"nmhc","year":1,"mode":"rotation","priority":"ЛТ"}'
check "создание ординатора" 201 '"orgId":"nmhc"'
RID=$(grep -o '"id":"[^"]*"' <<<"$BODY" | head -1 | cut -d'"' -f4)
req PUT "/residents/$RID" '{"fio":"Тестов Тест Тестович","orgId":"nmhc","year":2,"mode":"fixed"}'
check "правка ординатора" 200 '"mode":"fixed"'

# ── календарь ──
req PUT /years/2025-26/weeks '{"weeks":[{"num":35,"isRotation":false,"note":"нет ротации"}]}'
check "неделя 35 выключена" 200 '"isRotation":false'
req POST /years/2025-26/overrides '{"dateFrom":"2025-12-11","dateTo":"2025-12-11","kind":"off","note":"тестовый выходной"}'
check "исключение по дню добавлено" 201 '"kind":"off"'
OID=$(grep -o '"id":[0-9]*' <<<"$BODY" | head -1 | cut -d: -f2)
req GET /curators/levitskiy/dashboard
check "dashboard после исключения" 200 '"curator"'
req DELETE "/overrides/$OID"
check "исключение удалено" 200 '"overrides"'
if grep -qF "тестовый выходной" <<<"$BODY"; then echo "FAIL исключение осталось в списке"; FAIL=$((FAIL+1)); fi
req PUT /years/2025-26/weeks '{"weeks":[{"num":35,"isRotation":true}]}'
check "неделя 35 включена обратно" 200 '"num":35'

# ── генератор ──
req POST /generate '{"orgId":"mmcc","fromWeek":1,"seed":1}'
check "генерация (предпросмотр)" 200 '"blocks"'
check "в генерации есть seed" 200 '"seed":1'
req POST /blocks/bulk '{"residentIds":["buh"],"fromWeek":31,"blocks":[{"residentId":"buh","unitId":"ld","from":31,"to":32},{"residentId":"buh","unitId":"iuzi","from":33,"to":34}]}'
check "массовая запись блоков" 200 '"ok"'
req POST /blocks/bulk '{"residentIds":["buh"],"fromWeek":31,"blocks":[{"residentId":"buh","unitId":"ld","from":31,"to":32},{"residentId":"buh","unitId":"iuzi","from":32,"to":34}]}'
check "массовая запись с пересечением отклонена" 422 "Пересекается"

# ── пользователи и настройки ──
req GET /users
check "список пользователей" 200 '"login":"disp"'
req POST /users '{"login":"disp2","password":"secret123","name":"Второй","role":"dispatcher","orgId":"nmhc"}'
check "создание пользователя" 201 '"login":"disp2"'
req PUT /settings '{"capacityThreshold":4}'
check "порог загрузки изменён" 200 '"capacityThreshold":4'

# ── журнал правок ──
req GET /audit
check "журнал: создание" 200 'block_create'
check "журнал: назначение куратора" 200 'curator_assign'
check "журнал: удаление" 200 'block_delete'
check "журнал: генерация" 200 'generate_apply'
check "журнал: автор" 200 '"user":"admin"'

# ── выход ──
req POST /auth/logout
check "выход" 200 '"ok"'
req POST /blocks '{"residentId":"buh","unitId":"ooplt","from":35,"to":35}'
check "после выхода менять нельзя" 401 "авторизация"

# ── распорядитель: только своя организация ──
req POST /auth/login '{"login":"disp","password":"secret123"}' "$JAR3"
check "вход распорядителя" 200 '"role":"dispatcher"'
req PUT "/residents/$RID" '{"fio":"Чужой","orgId":"nmhc","year":1,"mode":"rotation"}' "$JAR3"
check "чужая организация запрещена" 403 "своей организации"
req GET /users "" "$JAR3"
check "пользователи закрыты для распорядителя" 403 "администратору"
req PUT /years/2025-26/weeks '{"weeks":[{"num":1,"isRotation":true}]}' "$JAR3"
check "календарь закрыт для распорядителя" 403 "администратору"
req PUT /blocks/b01/curator '{"curatorId":"umyarov"}' "$JAR3"
check "своя организация: назначение куратора" 200 '"curatorId":"umyarov"'
req GET /audit "" "$JAR3"
check "журнал распорядителя: свои правки видны" 200 'curator_assign'
if grep -qE 'user_create|settings_update|"orgId":"nmhc"' <<<"$BODY"; then echo "FAIL журнал распорядителя содержит чужие/админские записи"; FAIL=$((FAIL+1));
else echo "ok   журнал распорядителя без чужих и админских записей"; PASS=$((PASS+1)); fi

# ── ограничение перебора (отдельная cookie-сессия, тот же IP) ──
for i in 1 2 3 4 5; do req POST /auth/login '{"login":"admin","password":"bad"}' "$JAR2"; done
req POST /auth/login '{"login":"admin","password":"secret123"}' "$JAR2"
check "6-я попытка блокируется (429)" 429 "попыток"

# ── notify.php: сухой прогон на фиксированную дату ──
# 11.12.2025 (чт) — предпоследний рабочий день недели 14: у Левицкого завершается
# ротация ординатора buh (нед. 11–14), у администратора — срочные manual-блоки.
NOTIFY_OUT=$(php "$ROOT/backend/notify.php" 2025-12-11)
for pat in "DRY-RUN" "Завершается ротация" "администратору"; do
  if grep -qF "$pat" <<<"$NOTIFY_OUT"; then echo "ok   notify: есть «$pat»"; PASS=$((PASS+1));
  else echo "FAIL notify: нет «$pat»"; FAIL=$((FAIL+1)); fi
done
if php "$ROOT/backend/notify.php" 2025-12-13 | grep -qF "выходной"; then
  echo "ok   notify: суббота — рассылки нет"; PASS=$((PASS+1))
else echo "FAIL notify: суббота должна пропускаться"; FAIL=$((FAIL+1)); fi

echo "──────────────────────────────"
echo "Итог: пройдено $PASS, провалено $FAIL"
[[ $FAIL -eq 0 ]]
