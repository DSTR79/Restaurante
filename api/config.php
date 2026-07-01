<?php
header('Content-Type: application/json; charset=utf-8');

// Cargar variables de entorno desde .env si existe
if (file_exists(__DIR__ . '/../.env')) {
    $lines = file(__DIR__ . '/../.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos($line, '#') === 0) continue;
        list($key, $value) = explode('=', $line, 2);
        putenv(trim($key) . '=' . trim($value));
    }
}

// Solo permitir obtener configuración no sensible desde el cliente
// La contraseña se valida en el servidor, nunca se expone
$response = [
    'app_name' => 'POS System',
    'version' => '1.0.0'
];

echo json_encode($response);
?>
