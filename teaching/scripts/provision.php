<?php
// CLI only. Provision an empty isolated database from a private JSON file.
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../backend/Service.php';
$config=require $argv[1];$seed=json_decode(file_get_contents($argv[2]),true,flags:JSON_THROW_ON_ERROR);
$s=new Teaching\Service($config);
$s->transaction(function()use($s,$seed){
    if($s->all('SELECT 1 FROM users LIMIT 1'))throw new RuntimeException('Database already provisioned; refusing overwrite.');
    foreach($seed['teachers'] as $t)$s->db()->prepare('INSERT INTO teachers(id,name,rate) VALUES(?,?,?)')->execute([$t['id'],$t['name'],$t['rate']]);
    foreach($seed['groups'] as $g)$s->db()->prepare('INSERT INTO groups(id,course,semester,label) VALUES(?,?,?,?)')->execute([$g['id'],$g['course'],$g['semester'],$g['label']]);
    foreach($seed['users'] as $u){if(strlen($u['password'])<16)throw new RuntimeException('Use a unique password of at least 16 characters.');$s->db()->prepare('INSERT INTO users(login,password_hash,name,roles,teacher_id) VALUES(?,?,?,?,?)')->execute([$u['login'],password_hash($u['password'],PASSWORD_DEFAULT),$u['name'],json_encode($u['roles']),$u['teacher_id']??null]);}
});
echo "Provisioned isolated database.\n";
