<?php
$path=rawurldecode(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH));
if(preg_match('~/(?:_private|_app|\.)|\.(?:sqlite|db|sql|log|bak|env|xlsx|docx|json)$~',$path)){http_response_code(403);exit('Forbidden');}
return false;
