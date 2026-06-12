<?php
require_once 'db.php';

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
