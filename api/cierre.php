<?php
require_once 'db.php';
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

function sendJson($payload, int $status = 200) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function sendError(string $message, int $status = 400) {
    sendJson(['error' => $message], $status);
}

function getAction() {
    return $_REQUEST['action'] ?? 'datos';
}

// Endpoint de validación de contraseña
$action = getAction();
if ($action === 'validar_password') {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'POST') {
        sendError('Método no permitido', 405);
    }
    
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    $password = trim($body['password'] ?? '');
    
    if (!$password) {
        sendError('Contraseña requerida', 400);
    }
    
    $admin_password = getenv('ADMIN_PASSWORD');
    if (!$admin_password) {
        sendError('Error de configuración del servidor', 500);
    }
    
    $valido = ($password === $admin_password);
    sendJson(['valido' => $valido], $valido ? 200 : 403);
}

function ensureCierreTable(PDO $pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS CIERRES (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        FECHA_INICIO DATETIME DEFAULT NULL,
        FECHA_FIN DATETIME NOT NULL,
        TOTAL DECIMAL(12,2) NOT NULL,
        DETALLE LONGTEXT NOT NULL,
        CREADO_EN TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
}

function obtenerUltimoCierre(PDO $pdo) {
    $stmt = $pdo->query('SELECT FECHA_FIN FROM CIERRES ORDER BY FECHA_FIN DESC LIMIT 1');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    return $result['FECHA_FIN'] ?? null;
}

function obtenerMesasCobradas(PDO $pdo) {
    $stmt = $pdo->query("SELECT MESA, NOMBRE_MESA AS nombre FROM MESAS WHERE ESTADO_MESA = 'COBRADA' ORDER BY MESA ASC");
    $mesas = [];
    while ($mesa = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $lineasStmt = $pdo->prepare(
            "SELECT l.REF_LIN AS producto_id,
                    MAX(COALESCE(a.TEXTO_ARTICULO, l.TEXTO_LIN)) AS nombre,
                    SUM(l.UNIDS) AS cantidad,
                    l.PV_LIN AS precio,
                    SUM(l.UNIDS * l.PV_LIN) AS subtotal
             FROM LINEAS l
             LEFT JOIN ARTICULOS a ON a.REF = l.REF_LIN
             WHERE l.MESA_LIN = ? AND l.ESTADO_LIN = 'PAGADO'
             GROUP BY l.REF_LIN, l.PV_LIN
             ORDER BY nombre ASC"
        );
        $lineasStmt->execute([$mesa['MESA']]);
        $lineas = $lineasStmt->fetchAll(PDO::FETCH_ASSOC);

        $total = 0.0;
        foreach ($lineas as $linea) {
            $total += floatval($linea['subtotal']);
        }

        $mesas[] = [
            'mesa' => $mesa['MESA'],
            'nombre' => $mesa['nombre'],
            'total' => number_format($total, 2, '.', ''),
            'lineas' => array_map(function ($linea) {
                return [
                    'producto_id' => $linea['producto_id'],
                    'nombre' => $linea['nombre'],
                    'cantidad' => (int)$linea['cantidad'],
                    'precio' => number_format(floatval($linea['precio']), 2, '.', ''),
                    'subtotal' => number_format(floatval($linea['subtotal']), 2, '.', ''),
                ];
            }, $lineas),
        ];
    }

    return $mesas;
}

function obtenerMesasPendientes(PDO $pdo) {
    $stmt = $pdo->query("SELECT MESA, NOMBRE_MESA AS nombre, TOTAL_PTE AS total_pendiente FROM MESAS WHERE ESTADO_MESA != 'COBRADA' AND COALESCE(TOTAL_PTE, 0) > 0 ORDER BY MESA ASC");
    $result = [];
    while ($mesa = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $result[] = [
            'mesa' => $mesa['MESA'],
            'nombre' => $mesa['nombre'],
            'total_pendiente' => number_format(floatval($mesa['total_pendiente']), 2, '.', ''),
        ];
    }
    return $result;
}

function obtenerTotal(array $mesas) {
    $total = 0.0;
    foreach ($mesas as $mesa) {
        $total += floatval($mesa['total']);
    }
    return number_format($total, 2, '.', '');
}

function datosCierre(PDO $pdo) {
    ensureCierreTable($pdo);

    $lastCierre = obtenerUltimoCierre($pdo);
    $mesas = obtenerMesasCobradas($pdo);
    $total = obtenerTotal($mesas);
    $pendientes = obtenerMesasPendientes($pdo);

    sendJson([
        'success' => true,
        'desde_ultimo_cierre' => $lastCierre,
        'mesas_cobradas' => $mesas,
        'pendientes' => $pendientes,
        'total_dia' => $total,
    ]);
}

function cerrarDia(PDO $pdo) {
    ensureCierreTable($pdo);

    $mesas = obtenerMesasCobradas($pdo);
    if (empty($mesas)) {
        sendError('No hay mesas cobradas para cerrar.', 400);
    }

    $total = obtenerTotal($mesas);
    $lastCierre = obtenerUltimoCierre($pdo);
    $detalle = json_encode(['mesas' => $mesas, 'total' => $total], JSON_UNESCAPED_UNICODE);

    if ($lastCierre) {
        $stmt = $pdo->prepare('INSERT INTO CIERRES (FECHA_INICIO, FECHA_FIN, TOTAL, DETALLE) VALUES (?, NOW(), ?, ?)');
        $stmt->execute([$lastCierre, $total, $detalle]);
    } else {
        $stmt = $pdo->prepare('INSERT INTO CIERRES (FECHA_INICIO, FECHA_FIN, TOTAL, DETALLE) VALUES (NULL, NOW(), ?, ?)');
        $stmt->execute([$total, $detalle]);
    }

    $mesasIds = array_map(fn($m) => $m['mesa'], $mesas);
    if (!empty($mesasIds)) {
        $placeholders = implode(',', array_fill(0, count($mesasIds), '?'));
        $deleteLines = $pdo->prepare("DELETE FROM LINEAS WHERE MESA_LIN IN ($placeholders)");
        $deleteLines->execute($mesasIds);
        $deleteMesas = $pdo->prepare("DELETE FROM MESAS WHERE MESA IN ($placeholders)");
        $deleteMesas->execute($mesasIds);
    }

    sendJson([
        'success' => true,
        'total' => $total,
        'mesas_cerradas' => count($mesas),
        'fecha_fin' => date('Y-m-d H:i:s'),
    ]);
}

$action = getAction();

switch ($action) {
    case 'datos':
        datosCierre($pdo);
        break;
    case 'cerrar':
        cerrarDia($pdo);
        break;
    default:
        sendError('Acción desconocida', 400);
}
