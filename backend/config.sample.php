<?php
// Конфигурация backend'а дашборда ротаций.
//
// НЕ хранить реальный файл в git. Скопируйте его как config.php:
//   - на хостинге Timeweb — В КАТАЛОГ НАД webroot'ом поддомена, под именем
//     rotation-config.php (например /home/c/ваш_логин/rotation-config.php),
//     чтобы файл с паролем БД не был доступен по URL;
//   - для локальной разработки — рядом с этим файлом (backend/config.php,
//     он в .gitignore).
// Путь можно задать и явно через переменную окружения ROTATION_CONFIG.

return [
    // Подключение к БД. На хостинге Timeweb pdo_sqlite недоступен —
    // используется MySQL, база создаётся в панели «Базы данных MySQL».
    'dsn'     => 'mysql:host=localhost;dbname=XXXXX_rotation;charset=utf8mb4',
    'db_user' => 'XXXXX_rotation',
    'db_pass' => 'ПАРОЛЬ_ИЗ_ПАНЕЛИ',

    // Для локальной разработки вместо MySQL можно указать SQLite:
    // 'dsn' => 'sqlite:' . __DIR__ . '/rotation.db', 'db_user' => null, 'db_pass' => null,

    // Файл журнала рассылки notify.php (сухой прогон этапа 1).
    // Держите его вне webroot'а. null — backend/logs/notify.log.
    'notify_log' => null,
];
