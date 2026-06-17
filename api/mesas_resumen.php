<?php
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

try {
    // No deben reabrirse las mesas ya cobradas.
    // Solo los estados ocupados se liberan por timeout si no hay ping.
    $pdo->exec("UPDATE MESAS SET ESTADO_MESA = 'DISPONIBLE', ABIERTO_POR = NULL WHERE ESTADO_MESA = 'OCUPADA' AND (LAST_PING IS NULL OR LAST_PING < DATE_SUB(NOW(), INTERVAL 30 SECOND))");

    $mesasStmt = $pdo->query('SELECT MESA, NOMBRE_MESA AS NOMBRE, ESTADO_MESA AS ESTADO, ABIERTO_POR FROM MESAS WHERE ESTADO_MESA != "COBRADA"');
    $mesas = [];
    while ($m = $mesasStmt->fetch(PDO::FETCH_ASSOC)) {
        $id = $m['MESA'];
        $sumUnids = 0.0;
        $sumTotal = 0.0;

        $linesStmt = $pdo->prepare('SELECT UNIDS, PV_LIN, ESTADO_LIN FROM LINEAS WHERE MESA_LIN = ?');
        $linesStmt->execute([$id]);
        while ($l = $linesStmt->fetch(PDO::FETCH_ASSOC)) {
            $estado = $l['ESTADO_LIN'] ?? '';
            if (trim($estado) === 'PAGADO') continue;
            $unids = floatval(str_replace(',', '.', $l['UNIDS'] ?? 0));
            $pv = floatval(str_replace(',', '.', $l['PV_LIN'] ?? 0));
            $sumUnids += $unids;
            $sumTotal += $unids * $pv;
        }

        // Solo mostramos mesas que tengan algo pendiente (consumo > 0)
        if ($sumTotal <= 0.001) {
            continue;
        }

        $mesas[] = [
            'MESA' => $id,
            'NOMBRE' => $m['NOMBRE'],
            'ESTADO' => $m['ESTADO'],
            'ABIERTO_POR' => $m['ABIERTO_POR'],
            'TOTAL' => number_format($sumTotal, 8, '.', ''),
            'TOTAL_PTE' => number_format($sumTotal, 8, '.', ''),
            'NUM_ARTICULOS' => number_format($sumUnids, 4, '.', '')
        ];
    }

    echo json_encode($mesas);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
