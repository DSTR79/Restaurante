<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function leerJsonBody() {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    return is_array($body) ? $body : [];
}

if ($method === 'POST') {
    $body = leerJsonBody();
    $nombre = trim($body['nombre'] ?? '');
    $password = trim($body['password'] ?? '');
    $ip = obtenerIPCliente();

    if ($nombre === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Introduce un nombre de usuario.']);
        exit;
    }

    $admin_password = getenv('ADMIN_PASSWORD');
    if (!$admin_password) {
        http_response_code(500);
        echo json_encode(['error' => 'Error de configuración: ADMIN_PASSWORD no definida']);
        exit;
    }

    if ($password !== $admin_password) {
        http_response_code(403);
        echo json_encode(['error' => 'Contraseña de administrador incorrecta.']);
        exit;
    }

    if ($ip === '') {
        http_response_code(400);
        echo json_encode(['error' => 'No se pudo detectar la IP del dispositivo.']);
        exit;
    }

    try {
        $stmt = $pdo->prepare('INSERT INTO ip_usuarios (ip_address, nombre_usuario) VALUES (?, ?) ON DUPLICATE KEY UPDATE nombre_usuario = VALUES(nombre_usuario)');
        $stmt->execute([$ip, $nombre]);

        echo json_encode([
            'autorizado' => true,
            'registrado' => true,
            'ip' => $ip,
            'nombre' => $nombre,
        ]);
    } catch (Throwable $e) {
        error_log('Error registrando dispositivo: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'Error registrando el dispositivo.']);
    }
    exit;
}

$usuario = obtenerUsuarioRegistradoPorIP();

if (!$usuario) {
    http_response_code(403);
    echo json_encode([
        'autorizado' => false,
        'ip' => obtenerIPCliente(),
        'error' => 'Acceso denegado: esta IP no está registrada.',
    ]);
    exit;
}

echo json_encode([
    'autorizado' => true,
    'ip' => obtenerIPCliente(),
    'nombre' => $usuario['nombre_usuario'],
]);
?>
