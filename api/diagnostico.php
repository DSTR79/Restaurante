<?php
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

echo "<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<title>Diagnóstico Mesas</title>
<style>
body { font-family: monospace; padding: 20px; background: #f5f5f5; }
.section { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
h2 { border-bottom: 2px solid #007bff; padding-bottom: 10px; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f9f9f9; font-weight: bold; }
.ok { color: green; }
.warning { color: orange; }
.error { color: red; }
pre { background: #f9f9f9; padding: 10px; overflow-x: auto; border: 1px solid #ddd; }
</style>
</head>
<body>
<h1>📊 Diagnóstico del Sistema de Mesas</h1>
";

try {
    // 1. Conexión DB
    echo "<div class='section'>
    <h2>1️⃣ Conexión a Base de Datos</h2>";
    try {
        $test = $pdo->query("SELECT 1");
        echo "<p class='ok'>✓ Conexión exitosa</p>";
    } catch (Exception $e) {
        echo "<p class='error'>✗ Error: " . $e->getMessage() . "</p>";
    }
    echo "</div>";
    
    // 2. Mesas
    echo "<div class='section'>
    <h2>2️⃣ Estado de Mesas</h2>";
    $stmt = $pdo->query("SELECT MESA, NOMBRE_MESA, ESTADO_MESA, TOTAL_PTE FROM MESAS ORDER BY MESA");
    $mesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (count($mesas) > 0) {
        echo "<table>
        <tr><th>ID</th><th>Nombre</th><th>Estado</th><th>Total Pte</th></tr>";
        foreach ($mesas as $m) {
            echo "<tr>
            <td>" . $m['MESA'] . "</td>
            <td>" . $m['NOMBRE_MESA'] . "</td>
            <td>" . $m['ESTADO_MESA'] . "</td>
            <td>" . $m['TOTAL_PTE'] . "€</td>
            </tr>";
        }
        echo "</table>";
    } else {
        echo "<p class='error'>No hay mesas</p>";
    }
    echo "</div>";
    
    // 3. Líneas por mesa
    echo "<div class='section'>
    <h2>3️⃣ Líneas Pendientes por Mesa</h2>";
    
    foreach ($mesas as $m) {
        $mesaId = (int)$m['MESA'];
        $stmt2 = $pdo->query("SELECT l.LINEA, l.TEXTO_LIN, l.UNIDS, l.PV_LIN, l.ESTADO_LIN 
                             FROM LINEAS l 
                             WHERE l.MESA_LIN = $mesaId 
                             ORDER BY l.LINEA");
        $lineas = $stmt2->fetchAll(PDO::FETCH_ASSOC);
        
        echo "<h3>Mesa {$m['MESA']} - {$m['NOMBRE_MESA']}</h3>";
        
        if (count($lineas) > 0) {
            echo "<table>
            <tr><th>Línea</th><th>Producto</th><th>Unids</th><th>Precio</th><th>Estado</th><th>Subtotal</th></tr>";
            
            $totalMesa = 0;
            foreach ($lineas as $l) {
                $estado = $l['ESTADO_LIN'];
                $isPendiente = ($estado !== 'PAGADO') ? 'class="ok"' : 'class="error"';
                $unids = (int)$l['UNIDS'];
                $precio = (float)$l['PV_LIN'];
                $subtotal = $unids * $precio;
                if ($estado !== 'PAGADO') $totalMesa += $subtotal;
                
                echo "<tr>
                <td>" . $l['LINEA'] . "</td>
                <td>" . htmlspecialchars($l['TEXTO_LIN']) . "</td>
                <td>" . $unids . "</td>
                <td>" . $precio . "€</td>
                <td $isPendiente>" . $estado . "</td>
                <td>" . $subtotal . "€</td>
                </tr>";
            }
            echo "</table>";
            echo "<p><strong>Total pendiente calculado:</strong> <span class='ok'>" . $totalMesa . "€</span></p>";
        } else {
            echo "<p class='warning'>Sin líneas</p>";
        }
    }
    echo "</div>";
    
    // 4. Test endpoint
    echo "<div class='section'>
    <h2>4️⃣ Simulación del Endpoint</h2>";
    echo "<p>Llamando: <code>/api/mesas.php?action=obtenerMesasDisponiblesConLineas&mesa_activa=0</code></p>";
    echo "<pre>";
    
    $mesaActiva = 0;
    $sql = "SELECT m.MESA, m.NOMBRE_MESA, m.ESTADO_MESA, m.ABIERTO_POR
            FROM MESAS m
            WHERE m.ESTADO_MESA != 'COBRADA'";
    if ($mesaActiva > 0) {
        $sql .= " AND m.MESA != $mesaActiva";
    }
    
    echo "SQL 1: " . $sql . "\n\n";
    
    $stmt = $pdo->query($sql);
    $mesasTest = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo "Mesas encontradas: " . count($mesasTest) . "\n";
    
    $resultFinal = [];
    foreach ($mesasTest as $m) {
        $id = (int)$m['MESA'];
        $sqlLin = "SELECT l.REF_LIN, l.TEXTO_LIN, l.UNIDS, l.PV_LIN, l.COMANDA_LIN
                   FROM LINEAS l
                   WHERE l.MESA_LIN = $id AND COALESCE(l.ESTADO_LIN,'') != 'PAGADO'";
        
        echo "\nMesa $id SQL: " . $sqlLin . "\n";
        
        $stmtLin = $pdo->query($sqlLin);
        $lineas = $stmtLin->fetchAll(PDO::FETCH_ASSOC);
        
        echo "Líneas encontradas: " . count($lineas) . "\n";
        
        if (count($lineas) > 0) {
            $total = 0;
            foreach ($lineas as $lin) {
                $subtotal = (int)$lin['UNIDS'] * (float)$lin['PV_LIN'];
                $total += $subtotal;
                echo "  - " . $lin['TEXTO_LIN'] . ": " . $lin['UNIDS'] . " x " . $lin['PV_LIN'] . "€ = " . $subtotal . "€\n";
            }
            
            $resultFinal[] = [
                'mesa' => $id,
                'nombre' => $m['NOMBRE_MESA'],
                'total_pte' => $total,
                'lineas' => count($lineas)
            ];
        }
    }
    
    echo "\n\n=== RESULTADO FINAL ===\n";
    echo json_encode($resultFinal, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
    echo "</pre>";
    echo "</div>";
    
} catch (Throwable $e) {
    echo "<div class='section'><p class='error'>ERROR: " . $e->getMessage() . "</p><pre>" . $e->getTraceAsString() . "</pre></div>";
}

echo "
</body>
</html>";
?>
