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
 * Con reintentos automáticos y manejo robusto de sockets
 * Incluye reset de impresora para evitar "cuelgues"
 */
function sendToPrinterNetwork($ip, $port, $text, $timeout = 10, $retries = 3) {
    // RESET previo: limpiar buffer de impresora (ESC @ = reset)
    $resetCmd = "\x1B\x40"; // ESC @ = Reset
    $ticketData = $resetCmd . $text . "\x1B\x64\x06\x1D\x56\x00"; // reset + ticket + corte
    $lastError = '';
    
    for ($attempt = 1; $attempt <= $retries; $attempt++) {
        $socket = @fsockopen($ip, $port, $errno, $errstr, $timeout);
        
        if (!$socket) {
            $lastError = "Intento $attempt/$retries: No se pudo conectar a $ip:$port. Error: $errstr ($errno)";
            // Esperar antes de reintentar (backoff exponencial)
            if ($attempt < $retries) {
                usleep(500000 * $attempt); // 0.5s, 1s, 1.5s...
            }
            continue;
        }
        
        // Socket conectado. Asegurar que se cierre en cualquier caso
        try {
            // Establecer timeout de lectura/escritura
            stream_set_timeout($socket, $timeout);
            
            // Intentar escribir
            $sent = @fwrite($socket, $ticketData);
            
            if ($sent === false || $sent == 0) {
                $lastError = "Intento $attempt/$retries: Error al escribir en socket";
                @fclose($socket);
                if ($attempt < $retries) {
                    usleep(500000 * $attempt);
                }
                continue;
            }
            
            // Dar MÁS tiempo para procesar reset + print + corte (aumentado)
            usleep(500000); // 0.5s (antes era 0.1s)
            
            // Cerrar socket correctamente
            @fclose($socket);
            
            return ['success' => true, 'attempt' => $attempt];
            
        } catch (Exception $e) {
            $lastError = "Intento $attempt/$retries: Excepción: " . $e->getMessage();
            @fclose($socket);
            if ($attempt < $retries) {
                usleep(500000 * $attempt);
            }
        }
    }
    
    return [
        'success' => false,
        'error' => $lastError,
        'retries_attempted' => $retries
    ];
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
    echo json_encode(['success' => true, 'attempt' => $result['attempt']]);
} else {
    http_response_code(503);
    echo json_encode($result);
}
?>
