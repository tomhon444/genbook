<?php
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
try {
    $settings = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
    if (getenv('NODE_ENV') === 'production' || $settings['databasePort'] !== 3306) {
        throw new RuntimeException('Environment guard rejected');
    }
    $db = new mysqli('127.0.0.1', 't02_fixture', $settings['appPassword'], 't02_genbook', 3306);
    $count = $db->query('SELECT COUNT(*) AS n FROM t02_central.STAFF_INFO')->fetch_assoc();
    if ((int)$count['n'] !== 6) throw new RuntimeException('Fixture count mismatch');
    $db->begin_transaction();
    $denied = false;
    try { $db->query('INSERT INTO t02_genbook.genbook (gen_book_id) VALUES (999)'); }
    catch (mysqli_sql_exception $error) { $denied = $error->getCode() === 1142; }
    finally { $db->rollback(); }
    if (!$denied) throw new RuntimeException('App account must not write');
    define('BASEPATH', __DIR__);
    define('ENVIRONMENT', 'testing');
    $installedAdapter = dirname($argv[1]) . '/web/application/libraries/Authen.php';
    if (hash_file('sha256', $installedAdapter) !== hash_file('sha256', __DIR__ . '/DenyRemoteAuth.php')) {
        throw new RuntimeException('Installed SOAP deny adapter differs');
    }
    require $installedAdapter;
    $soap = new Authen();
    if ($soap->Staff_Verify('t02_owner', 'not-a-real-password') !== FALSE) {
        throw new RuntimeException('Unused SOAP adapter must fail closed');
    }
    $books = $db->query('SELECT COUNT(*) AS n FROM genbook')->fetch_assoc();
    if ((int)$books['n'] !== 0) throw new RuntimeException('Sandbox must contain no books');
    echo json_encode(array('mysqlVersion' => $db->server_info, 'staffFixtures' => 6, 'bookRows' => 0,
        'appInsertDenied' => true, 'remoteSoapDisabled' => true, 'connectionHost' => '127.0.0.1', 'port' => 3306));
} catch (Throwable $error) {
    fwrite(STDERR, json_encode(array('verification' => false, 'errorCode' => $error->getCode())));
    exit(1);
}
