<?php
/**
 * Print Direct - Imprime tickets via red a la impresora POS-80C
 *
 * Protocolo: LPR/raw socket (puerto 9100)
 * NO necesita SMB, usuario, password ni PC intermediaria
 * Funciona desde cualquier dispositivo con acceso a la red
 * Escalable a múltiples locales
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ============================================================
// CONFIGURACION (lee desde config.json)
// ============================================================
$configFile = dirname(__DIR__) . '/config.json';
$config = file_exists($configFile) 
    ? json_decode(file_get_contents($configFile), true) 
    : [];

// Impresoras: barra, cocina, cobro
$printers = $config['printers'] ?? [];

function getPrinterConfig($name) {
    global $printers;
    $default = ['ip' => '192.168.2.78', 'port' => 9100, 'timeout' => 5];
    return $printers[$name] ?? $default;
}

// Para compatibilidad con código antiguo
$cobro_config = getPrinterConfig('cobro');
$PRINTER_IP = $cobro_config['ip'];
$PRINTER_PORT = $cobro_config['port'];
$PRINTER_TIMEOUT = $cobro_config['timeout'];
// ============================================================

/**
 * Enviar ticket via socket TCP (LPR/raw) a impresora en red
 */
function sendToPrinterNetwork($ip, $port, $text, $timeout = 5) {
    $ticketData = $text . "\x1B\x64\x06\x1D\x56\x00"; // avance 6 lineas + corte
    
    $socket = @fsockopen($ip, $port, $errno, $errstr, $timeout);
    if (!$socket) {
        return [
            'success' => false,
            'error' => "No se pudo conectar a $ip:$port. Error: $errstr ($errno)"
        ];
    }
    
    $sent = @fwrite($socket, $ticketData);
    @fclose($socket);
    
    if ($sent === false) {
        return ['success' => false, 'error' => 'Error al enviar datos a la impresora'];
    }
    
    return ['success' => true];
}

/**
 * Enviar ticket (impresora en red IP)
 */
function sendToPrinter($text) {
    global $PRINTER_IP, $PRINTER_PORT, $PRINTER_TIMEOUT;
    return sendToPrinterNetwork($PRINTER_IP, $PRINTER_PORT, $text, $PRINTER_TIMEOUT);
}

/**
 * Enviar ticket a impresora específica por config
 */
function sendToPrinterByConfig($printerCfg, $text) {
    $ip = $printerCfg['ip'] ?? '192.168.2.78';
    $port = $printerCfg['port'] ?? 9100;
    $timeout = $printerCfg['timeout'] ?? 5;
    return sendToPrinterNetwork($ip, $port, $text, $timeout);
}

/**
 * Ping a impresora específica por config
 */
function pingPrinterConfig($printerCfg, $name = 'unknown') {
    $ip = $printerCfg['ip'] ?? '192.168.2.78';
    $port = $printerCfg['port'] ?? 9100;
    $timeout = $printerCfg['timeout'] ?? 5;
    
    $socket = @fsockopen($ip, $port, $errno, $errstr, $timeout);
    if (!$socket) {
        return [
            'ok' => false,
            'error' => "Impresora $name en $ip:$port no responde. Verifica: 1) IP correcta, 2) Impresora encendida, 3) Puerto 9100 abierto"
        ];
    }
    @fclose($socket);
    
    return [
        'ok' => true,
        'printer' => 'POS-80C',
        'name' => $name,
        'ip' => $ip,
        'port' => $port,
        'method' => 'network_socket'
    ];
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================

if (isset($_GET['action']) && $_GET['action'] === 'ping') {
    // Ping a impresora específica o a cobro por defecto
    $printerName = $_GET['printer'] ?? 'cobro';
    $printerCfg = getPrinterConfig($printerName);
    echo json_encode(pingPrinterConfig($printerCfg, $printerName));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || empty($input['text'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Ticket vacio']);
    exit;
}

// Destino: 'barra', 'cocina', 'cobro' (por defecto)
$printerName = $input['printer'] ?? 'cobro';
$printerCfg = getPrinterConfig($printerName);

$result = sendToPrinterByConfig($printerCfg, $input['text']);

if ($result['success']) {
    echo json_encode(['success' => true]);
} else {
    http_response_code(503);
    echo json_encode($result);
}
?>
