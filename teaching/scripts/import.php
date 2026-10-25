<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
require __DIR__.'/../backend/Service.php';require __DIR__.'/../backend/Workbook.php';
$s=new Teaching\Service(require $argv[1]);$u=$s->all('SELECT id,name,roles,teacher_id FROM users ORDER BY id LIMIT 1')[0];$u['roles']=json_decode($u['roles'],true);
$w=new Teaching\Workbook($s);$p=$w->preview($argv[2],$argv[4]??basename($argv[2]),$u);
echo json_encode(['rows'=>$p['rows'],'total_cent'=>$p['total_cent'],'monthly'=>$p['monthly'],'errors'=>$p['errors']],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT)."\n";
if($p['errors'])exit(2);
if(($argv[3]??'')==='--commit'){$w->commit(['token'=>$p['token']],$u);$s->db()->exec('PRAGMA wal_checkpoint(TRUNCATE)');echo "Imported as plan; facts remain unchanged.\n";}
