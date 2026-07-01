<?php
header('Content-Type: text/plain; charset=utf-8');

$ip = '192.168.2.78';
$port = 9100;
$timeout = 5;

echo "=== TEST CONEXION IMPRESORA ===\n";
echo "IP: $ip\n";
echo "Puerto: $port\n";
echo "Timeout: $timeout segundos\n\n";

// Test fsockopen (igual que print.php)
echo "[1] Intentando fsockopen()...\n";
$socket = @fsockopen($ip, $port, $errno, $errstr, $timeout);

if ($socket) {
    echo "✓ CONECTADO\n";
    echo "Enviando test ticket...\n";
    
    $testTicket = "TEST TICKET\n";
    $testTicket .= "192.168.2.1\n";
    $testTicket .= date('Y-m-d H:i:s') . "\n";
    $testTicket .= str_repeat("-", 32) . "\n";
    $testTicket .= "\x1B\x64\x06\x1D\x56\x00"; // corte
    
    $sent = @fwrite($socket, $testTicket);
    echo "Bytes enviados: $sent\n";
    
    @fclose($socket);
    echo "✓ Socket cerrado\n";
} else {
    echo "✗ NO CONECTA\n";
    echo "Error: $errstr ($errno)\n";
}

echo "\n[2] Verificando config.json...\n";
$configFile = dirname(__DIR__) . '/config.json';
if (file_exists($configFile)) {
    $config = json_decode(file_get_contents($configFile), true);
    echo "Config loaded:\n";
    echo "  printers.cobro.ip: " . ($config['printers']['cobro']['ip'] ?? 'NOT SET') . "\n";
    echo "  printers.cobro.port: " . ($config['printers']['cobro']['port'] ?? 'NOT SET') . "\n";
} else {
    echo "✗ config.json NO EXISTE\n";
}
?>
