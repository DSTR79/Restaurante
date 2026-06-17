<?php
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

try {
    echo "=== TEST MESAS ===\n\n";
    
    // 1. Todas las mesas
    echo "1. TODAS LAS MESAS:\n";
    $stmt = $pdo->query("SELECT MESA, NOMBRE_MESA, ESTADO_MESA, TOTAL_PTE FROM MESAS ORDER BY MESA");
    $mesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($mesas, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n\n";
    
    // 2. Todas las líneas
    echo "2. TODAS LAS LINEAS:\n";
    $stmt = $pdo->query("SELECT l.LINEA, l.MESA_LIN, l.REF_LIN, l.TEXTO_LIN, l.UNIDS, l.PV_LIN, l.ESTADO_LIN 
                        FROM LINEAS l 
                        ORDER BY l.MESA_LIN, l.LINEA");
    $lineas = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($lineas, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n\n";
    
    // 3. Líneas pendientes por mesa
    echo "3. LINEAS PENDIENTES POR MESA:\n";
    $stmt = $pdo->query("SELECT l.MESA_LIN, COUNT(*) as total_lineas, 
                                SUM(CASE WHEN COALESCE(l.ESTADO_LIN,'') != 'PAGADO' THEN 1 ELSE 0 END) as pendientes,
                                SUM(CASE WHEN COALESCE(l.ESTADO_LIN,'') != 'PAGADO' THEN l.UNIDS * l.PV_LIN ELSE 0 END) as total_pte
                        FROM LINEAS l
                        GROUP BY l.MESA_LIN
                        ORDER BY l.MESA_LIN");
    $resumen = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($resumen, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n\n";
    
    // 4. Test del endpoint
    echo "4. TEST ENDPOINT (sin mesa_activa):\n";
    $stmt = $pdo->query("SELECT DISTINCT m.MESA, m.NOMBRE_MESA, m.ESTADO_MESA
                        FROM MESAS m
                        WHERE m.ESTADO_MESA != 'COBRADA'
                        ORDER BY m.MESA");
    $testMesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($testMesas as $mesa) {
        $mesaId = (int)$mesa['MESA'];
        $stmt2 = $pdo->query("SELECT l.LINEA, l.REF_LIN, l.TEXTO_LIN, l.UNIDS, l.PV_LIN, l.ESTADO_LIN 
                             FROM LINEAS l 
                             WHERE l.MESA_LIN = $mesaId 
                             AND COALESCE(l.ESTADO_LIN,'') != 'PAGADO'");
        $lineasPendientes = $stmt2->fetchAll(PDO::FETCH_ASSOC);
        
        $totalPte = 0;
        foreach ($lineasPendientes as $linea) {
            $totalPte += (int)$linea['UNIDS'] * (float)$linea['PV_LIN'];
        }
        
        echo "Mesa " . $mesa['MESA'] . " ({$mesa['NOMBRE_MESA']}) - {$mesa['ESTADO_MESA']} - $totalPte€ - " . count($lineasPendientes) . " lineas\n";
    }
    
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage();
}
?>
