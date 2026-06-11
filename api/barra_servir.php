<?php
require_once 'db.php';
header('Content-Type: application/json');

$input   = json_decode(file_get_contents('php://input'), true);
$linea   = $input['linea_id']  ?? null;
$mesa    = $input['mesa_id']   ?? null;
$todo    = $input['todo']      ?? false;

if (!$mesa) { http_response_code(400); echo json_encode(['error' => 'mesa_id requerido']); exit; }

try {
    if ($todo) {
        $stmt = $pdo->prepare("UPDATE LINEAS SET ESTADO_LIN = 'SERVIDO' WHERE MESA_LIN = ? AND ESTADO_LIN = 'PEDIDO'");
        $stmt->execute([$mesa]);
    } else {
        if (!$linea) { http_response_code(400); echo json_encode(['error' => 'linea_id requerido']); exit; }

        $stmt = $pdo->prepare('SELECT UNIDS, COMANDA_LIN, REF_LIN, TEXTO_LIN, PV_LIN, IVA_LIN, BASE_LIN FROM LINEAS WHERE LINEA = ? AND ESTADO_LIN = "PEDIDO"');
        $stmt->execute([$linea]);
        $line = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$line) {
            http_response_code(404);
            echo json_encode(['error' => 'Línea no encontrada o no está en estado PEDIDO']);
            exit;
        }

        $cantidad = (int)$line['UNIDS'];
        if ($cantidad > 1) {
            $baseTotal = floatval($line['BASE_LIN']);
            $unidadBase = $baseTotal > 0 ? $baseTotal / $cantidad : floatval($line['PV_LIN']);

            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = UNIDS - 1, BASE_LIN = BASE_LIN - ? WHERE LINEA = ?');
            $stmt->execute([$unidadBase, $linea]);

            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, 1, ?, ?, ?, "SERVIDO")');
            $stmt->execute([
                $line['COMANDA_LIN'],
                $mesa,
                $line['REF_LIN'],
                $line['TEXTO_LIN'],
                $line['PV_LIN'],
                $line['IVA_LIN'],
                $unidadBase
            ]);
        } else {
            $stmt = $pdo->prepare("UPDATE LINEAS SET ESTADO_LIN = 'SERVIDO' WHERE LINEA = ?");
            $stmt->execute([$linea]);
        }
    }
    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>