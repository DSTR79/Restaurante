<?php
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

try {
    echo "=== RECALCULANDO TOTALES ===\n\n";
    
    // Obtener todas las mesas
    $stmt = $pdo->query("SELECT MESA FROM MESAS");
    $mesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($mesas as $mesa) {
        $mesaId = (int)$mesa['MESA'];
        
        // Calcular total de líneas pendientes (no PAGADO)
        $stmt2 = $pdo->query("SELECT SUM(UNIDS * PV_LIN) as total 
                             FROM LINEAS 
                             WHERE MESA_LIN = $mesaId 
                             AND COALESCE(ESTADO_LIN,'') != 'PAGADO'");
        $result = $stmt2->fetch(PDO::FETCH_ASSOC);
        $totalPte = (float)($result['total'] ?? 0);
        
        // Actualizar MESAS.TOTAL_PTE
        $stmt3 = $pdo->prepare("UPDATE MESAS SET TOTAL_PTE = ? WHERE MESA = ?");
        $stmt3->execute([$totalPte, $mesaId]);
        
        echo "Mesa $mesaId: TOTAL_PTE = $totalPte\n";
    }
    
    echo "\n✓ Totales recalculados\n";
    
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage();
    echo "\nStack: " . $e->getTraceAsString();
}
?>
