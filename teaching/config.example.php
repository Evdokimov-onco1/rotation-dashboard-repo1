<?php
// Copy to the protected _private/config.php, never to the repository config.
return [
    'private_dir' => __DIR__,
    'template' => dirname(__DIR__).'/_app/templates/workload-blank.docx.blob',
    'secure' => true,
];
