<?php
declare(strict_types=1);
// Timeweb's Nginx serves common static extensions without Apache headers.
// Serve the document through PHP; private HTML uses an opaque extension.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
$file=__DIR__.'/_app/index.html.blob';
if(!is_file($file))$file=__DIR__.'/../frontend/dist/index.html';
if(!is_file($file)){http_response_code(503);echo 'Тестовая версия готовится к публикации.';exit;}
readfile($file);
