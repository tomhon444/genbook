<?php
// Creates new synthetic schemas only, using the existing local MySQL instance.
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
try {
    $settings = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
    $port = $settings['databasePort'];
    if ($port !== 3306 || getenv('NODE_ENV') === 'production') {
        throw new RuntimeException('Sandbox guard rejected environment');
    }
    // This legacy config was inspected first: it only defines arrays. It does
    // not open connections. Only the loopback genbook group is ever used here.
    define('BASEPATH', __DIR__);
    require 'C:/laragon/www/book-number/application/config/database.php';
    $local = $db['genbook'];
    if (!in_array($local['hostname'], array('127.0.0.1', 'localhost'), true)) {
        throw new RuntimeException('Existing book database is not local');
    }
    $db = new mysqli('127.0.0.1', $local['username'], $local['password'], '', $port);
    $db->set_charset('utf8mb4');
    $existing = $db->query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('t02_central','t02_genbook')");
    if ($existing->num_rows !== 0 || $db->query("SELECT User FROM mysql.user WHERE User='t02_fixture'")->num_rows !== 0) {
        throw new RuntimeException('Fixture schemas/user already exist; refusing to overwrite');
    }
    $db->multi_query(file_get_contents(__DIR__ . '/fixture.sql'));
    do { if ($result = $db->store_result()) { $result->free(); } } while ($db->more_results() && $db->next_result());
    $statement = $db->prepare('UPDATE t02_central.STAFF_INFO SET PASSWORD=? WHERE LOGIN=?');
    foreach ($settings['accounts'] as $account) {
        $statement->bind_param('ss', $account['password'], $account['username']);
        $statement->execute();
    }
    $password = $db->real_escape_string($settings['appPassword']);
    $db->query("CREATE USER 't02_fixture'@'localhost' IDENTIFIED BY '$password'");
    $db->query("GRANT SELECT ON t02_central.* TO 't02_fixture'@'localhost'");
    $db->query("GRANT SELECT ON t02_genbook.* TO 't02_fixture'@'localhost'");
    echo json_encode(array('initialized' => true, 'serverVersion' => $db->server_info, 'appPrivileges' => 'SELECT only'));
} catch (Throwable $exception) {
    // Error codes only: SQL or connection errors may contain generated credentials.
    fwrite(STDERR, json_encode(array('initialized' => false, 'errorCode' => $exception->getCode())));
    exit(1);
}
