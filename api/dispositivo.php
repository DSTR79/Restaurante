<?php
require_once 'db.php';

echo json_encode([
    'ip' => obtenerIPCliente(),
    'nombre' => obtenerNombreUsuarioPorIP(),
]);
?>
