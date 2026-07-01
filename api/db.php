<?php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', 1);

// Cargar variables de entorno desde .env si existe
if (file_exists(__DIR__ . '/../.env')) {
    $lines = file(__DIR__ . '/../.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos($line, '#') === 0) continue;
        list($key, $value) = explode('=', $line, 2);
        putenv(trim($key) . '=' . trim($value));
    }
}

$host = getenv('DB_HOST') ?: 'localhost';
$user = getenv('DB_USER') ?: 'ramon';
$pass = getenv('DB_PASSWORD');
$db   = getenv('DB_NAME') ?: 'Restaurante';

if (!$pass) {
    http_response_code(500);
    echo json_encode(['error' => 'Error de configuración: DB_PASSWORD no definida']);
    exit;
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Error de conexión a la base de datos: ' . $e->getMessage()]);
    exit;
}

function toFloat($val) {
    return (float) $val;
}

function verificarToken($pdo, $mesaId) {

    $stmt = $pdo->prepare('SELECT * FROM MESAS WHERE MESA = ? ');
    $stmt->execute([$mesaId]);
    $mesa = $stmt->fetch();

    if (!$mesa) {
        http_response_code(403);
        echo json_encode(['error' => 'Acceso denegado: sesión inválida o mesa bloqueada por otro camarero']);
        exit;
    }

    return $mesa;
}

function generarToken() {
    return bin2hex(random_bytes(32));
}

function obtenerIPCliente() {
    $headers = [
        'HTTP_CLIENT_IP',
        'HTTP_X_FORWARDED_FOR',
        'REMOTE_ADDR',
    ];

    foreach ($headers as $header) {
        if (empty($_SERVER[$header])) {
            continue;
        }

        $ip = trim(explode(',', $_SERVER[$header])[0]);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }

    return '';
}

function obtenerNombreUsuarioPorIP() {
    global $pdo;

    $ip = obtenerIPCliente();
    if ($ip === '') {
        return 'Sin identificar';
    }

    try {
        $stmt = $pdo->prepare('SELECT nombre_usuario FROM ip_usuarios WHERE TRIM(ip_address) = ?');
        $stmt->execute([$ip]);
        $result = $stmt->fetch();

        return $result ? $result['nombre_usuario'] : 'Sin identificar';
    } catch (Throwable $e) {
        error_log('Error en obtenerNombreUsuarioPorIP: ' . $e->getMessage());
        return 'Sin identificar';
    }
}

function obtenerUsuarioRegistradoPorIP() {
    global $pdo;

    $ip = obtenerIPCliente();
    if ($ip === '') {
        return null;
    }

    try {
        $stmt = $pdo->prepare('SELECT ip_address, nombre_usuario FROM ip_usuarios WHERE TRIM(ip_address) = ?');
        $stmt->execute([$ip]);
        $result = $stmt->fetch();

        return $result ?: null;
    } catch (Throwable $e) {
        error_log('Error en obtenerUsuarioRegistradoPorIP: ' . $e->getMessage());
        return null;
    }
}

function exigirUsuarioRegistrado() {
    $usuario = obtenerUsuarioRegistradoPorIP();

    if ($usuario) {
        return $usuario;
    }

    http_response_code(403);
    echo json_encode([
        'error' => 'Acceso denegado: esta IP no está registrada.',
        'ip' => obtenerIPCliente(),
    ]);
    exit;
}

function crearTablaIPUsuarios() {
    global $pdo;

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS ip_usuarios (
                ip_address VARCHAR(45) PRIMARY KEY,
                nombre_usuario VARCHAR(100) NOT NULL
            ) CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $e) {
        error_log('Error creando tabla ip_usuarios: ' . $e->getMessage());
    }
}

crearTablaIPUsuarios();

if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'dispositivo.php') {
    exigirUsuarioRegistrado();
}
?>
