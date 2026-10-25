<?php
declare(strict_types=1);
use Teaching\Service;
use Teaching\Auth;
use Teaching\Problem;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
$app=is_dir(__DIR__.'/../backend')?__DIR__.'/../backend':__DIR__.'/_app/backend';
require $app.'/Service.php';require $app.'/Auth.php';
try {
    $configFile=getenv('TEACHING_CONFIG')?:__DIR__.'/_private/config.php';
    if(!is_file($configFile))throw new Problem('Тестовая среда ещё не настроена.',503,'not_configured');
    $config=require $configFile;
    $sessionDir=$config['private_dir'].'/sessions';if(!is_dir($sessionDir))mkdir($sessionDir,0700,true);
    session_name('TEACHINGPREVIEWSESS');session_save_path($sessionDir);
    ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');
    session_set_cookie_params(['lifetime'=>0,'path'=>rtrim(dirname($_SERVER['SCRIPT_NAME']),'/').'/','secure'=>$config['secure']??true,'httponly'=>true,'samesite'=>'Strict']);
    session_start();
    $s=new Service($config);$auth=new Auth($s);$action=$_GET['action']??'';
    if(!is_string($action))throw new Problem('Неизвестное действие.',404);
    $method=$_SERVER['REQUEST_METHOD'];
    $reads=['bootstrap','report.snapshot','report.download'];
    if(($method==='GET'&&!in_array($action,$reads,true))||($method==='POST'&&in_array($action,$reads,true))||!in_array($method,['GET','POST'],true))throw new Problem('Неподдерживаемый метод запроса.',405,'method');
    if($method==='POST')$auth->checkCsrf($_SERVER['HTTP_X_CSRF_TOKEN']??'');
    $user=$auth->user();
    if($method==='POST'&&$action!=='import.preview'){
        $raw=file_get_contents('php://input',false,null,0,1048577);if(strlen($raw)>1048576)throw new Problem('Запрос слишком велик.',413);
        try{$input=json_decode($raw,true,64,JSON_THROW_ON_ERROR);}catch(JsonException){throw new Problem('Некорректный JSON.');}
        if(!is_array($input)||array_is_list($input)&&$input!==[])throw new Problem('Ожидается объект запроса.');
    }else{$input=$_GET;}
    if($action==='bootstrap'){$data=$user?$s->snapshot($user):['user'=>null,'preview'=>true];$data['csrf']=$auth->csrf();}
    elseif($action==='login'){
        $data=$auth->login($input);
        if($data['limited']??false)throw new Problem('Слишком много попыток. Повторите через 15 минут.',429,'rate_limit');
        if($data['invalid']??false)throw new Problem('Неверный логин или пароль.',401,'login');
    }elseif($action==='logout'){$data=$auth->logout();}
    else{
        if(!$user)throw new Problem('Войдите в модуль нагрузки.',401,'unauthenticated');
        if($action==='import.preview'){
            if(!isset($_FILES['file'])||$_FILES['file']['error']!==UPLOAD_ERR_OK||!is_uploaded_file($_FILES['file']['tmp_name']))throw new Problem('Не удалось загрузить XLSX. Максимальный размер — 10 МБ.');
            require_once $app.'/Workbook.php';$data=(new Teaching\Workbook($s))->preview($_FILES['file']['tmp_name'],$_FILES['file']['name'],$user);
        }elseif($action==='report.download'){
            require_once $app.'/Report.php';$r=(new Teaching\Report($s))->download((int)($_GET['id']??0),$user);
            session_write_close();header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');header('Content-Disposition: attachment; filename="'.$r['filename'].'"');header('Content-Length: '.filesize($r['path']));readfile($r['path']);exit;
        }else{$data=$s->dispatch($action,$input,$user);}
    }
    echo json_encode(['ok'=>true,'data'=>$data],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
}catch(Problem $e){http_response_code($e->status);echo json_encode(['ok'=>false,'error'=>['code'=>$e->kind,'message'=>$e->getMessage()]],JSON_UNESCAPED_UNICODE);}
catch(InvalidArgumentException $e){http_response_code(422);echo json_encode(['ok'=>false,'error'=>['code'=>'validation','message'=>$e->getMessage()]],JSON_UNESCAPED_UNICODE);}
catch(Throwable $e){error_log('Teaching error: '.get_class($e).' '.$e->getMessage());http_response_code(500);echo json_encode(['ok'=>false,'error'=>['code'=>'server','message'=>'Не удалось выполнить действие. Изменения не подтверждены; обновите страницу и повторите.']],JSON_UNESCAPED_UNICODE);}
