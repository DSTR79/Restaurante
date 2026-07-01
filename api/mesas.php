<?php
require_once 'db.php';
header('Content-Type: application/json; charset=utf-8');

function getJsonBody() {
    static $body;
    if ($body === null) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (!is_array($body)) {
            $body = [];
        }
    }
    return $body;
}

function sendJson($payload, int $status = 200) {
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function sendError(string $message, int $status = 400) {
    sendJson(['error' => $message], $status);
}

function getRequestParam(string $key, $default = null) {
    if (isset($_REQUEST[$key])) {
        return $_REQUEST[$key];
    }
    $body = getJsonBody();
    return $body[$key] ?? $default;
}

function agregarLineaTicket(array &$ticket, $producto_id, $nombre, $precio, $cantidad) {
    foreach ($ticket as &$linea) {
        if ($linea['producto_id'] == $producto_id && floatval($linea['precio']) === floatval($precio)) {
            $linea['cantidad'] += $cantidad;
            $linea['subtotal'] = $linea['cantidad'] * floatval($linea['precio']);
            return;
        }
    }
    $ticket[] = [
        'producto_id' => $producto_id,
        'nombre' => $nombre,
        'precio' => floatval($precio),
        'cantidad' => $cantidad,
        'subtotal' => $cantidad * floatval($precio),
    ];
}

function listarMesas() {
    global $pdo;

    try {
        $pdo->exec("UPDATE MESAS SET ESTADO_MESA = 'DISPONIBLE', ABIERTO_POR = NULL WHERE ESTADO_MESA = 'OCUPADA' AND (LAST_PING IS NULL OR LAST_PING < DATE_SUB(NOW(), INTERVAL 30 SECOND))");

        $stmt = $pdo->query("SELECT 
                m.FECHA_APERTURA AS FECHA,
                m.MESA,
                m.NOMBRE_MESA AS NOMBRE,
                m.ESTADO_MESA AS ESTADO,
                m.ABIERTO_POR,
                m.TOTAL_PTE,
                COALESCE(lin.TOTAL, 0) AS TOTAL
            FROM MESAS m
            LEFT JOIN (
                SELECT 
                    MESA_LIN,
                    SUM(
                        CASE 
WHEN COALESCE(ESTADO_LIN,'') != 'PAGADO' THEN UNIDS * PV_LIN
                            ELSE 0
                        END
                    ) AS TOTAL
                FROM LINEAS
                GROUP BY MESA_LIN
            ) lin ON lin.MESA_LIN = m.MESA");

        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        error_log('Error in mesas.php listar: ' . $e->getMessage());
        sendError('Database error: ' . $e->getMessage(), 500);
    }
}

function crearMesa() {
    global $pdo;
    $body = getJsonBody();
    $nombre = trim($body['nombre'] ?? '');

    if (!$nombre) {
        sendError('El nombre de la mesa es obligatorio', 400);
    }

    try {
        $stmt = $pdo->prepare('CALL NUEVA_MESA(?, @r_Mesa, @r_Comanda)');
        $stmt->execute([$nombre]);
        $result = $pdo->query('SELECT @r_Mesa AS mesa, @r_Comanda AS comanda_id')->fetch(PDO::FETCH_ASSOC);

        sendJson([
            'success' => true,
            'mesa' => $result['mesa'],
            'nombre' => $nombre,
            'comanda_id' => $result['comanda_id']
        ], 201);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function entrarMesa() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $camarero = obtenerNombreUsuarioPorIP();

    if (!$id) {
        sendError('El ID de la mesa es obligatorio', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT * FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $mesa = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$mesa) {
            sendError('Mesa no encontrada', 404);
        }

        if (($mesa['ESTADO_MESA'] ?? '') === 'OCUPADA') {
            sendError('Mesa bloqueada por ' . ($mesa['ABIERTA_POR'] ?? 'otro usuario') . '. Espera a que termine.', 403);
        }
        if (($mesa['ESTADO_MESA'] ?? '') === 'COBRADA') {
            sendError('Esta mesa ya está cobrada y cerrada.', 400);
        }

        $stmt = $pdo->prepare('CALL CAMBIAR_ESTADO_MESA (?, "OCUPADA", ?)');
        $stmt->execute([$id, $camarero]);

        $stmt = $pdo->prepare('SELECT * FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $updated = $stmt->fetch(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare('CALL NUEVA_COMANDA(?, @r_Comanda)');
        $stmt->execute([$id]);
        $result = $pdo->query('SELECT @r_Comanda AS comanda_id')->fetch(PDO::FETCH_ASSOC);

        sendJson(['mesa' => $updated, 'comanda_id' => $result['comanda_id'], 'success' => true]);
    } catch (Throwable $e) {
        sendError('Error de servidor: ' . $e->getMessage(), 500);
    }
}

function guardarYSalir() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $comanda = $body['comanda'] ?? '';

    if (!$id || !$comanda) {
        sendError('El ID de la mesa y la comanda son obligatorios', 400);
    }

    try {
        $stmt = $pdo->prepare('CALL GUARDAR_COMANDA(?, "PEDIDO", "EN CURSO")');
        $stmt->execute([$comanda]);

        // Obtener líneas con sus destinos
        $stmt = $pdo->prepare("
            SELECT l.LINEA, l.UNIDS, l.PV_LIN, l.TEXTO_LIN, a.DESTINO_ART, a.TEXTO_ARTICULO
            FROM LINEAS l
            JOIN ARTICULOS a ON a.REF = l.REF_LIN
            WHERE l.MESA_LIN = ? AND l.COMANDA_LIN = ? AND l.ESTADO_LIN NOT IN ('PAGADO', 'SERVIDO')
            ORDER BY a.DESTINO_ART ASC, l.LINEA ASC
        ");
        $stmt->execute([$id, $comanda]);
        $lineas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Agrupar por destino
        $ticketsPorDestino = [];
        foreach ($lineas as $linea) {
            $destino = $linea['DESTINO_ART'] ?? null;
            if ($destino === null || $destino === '') continue;

            if (!isset($ticketsPorDestino[$destino])) {
                $ticketsPorDestino[$destino] = [];
            }
            $ticketsPorDestino[$destino][] = $linea;
        }

        // Obtener datos de mesa
        $stmt = $pdo->prepare('SELECT NOMBRE_MESA FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $mesa = $stmt->fetch(PDO::FETCH_ASSOC);

        // Construir tickets
        $tickets = [];
        foreach ($ticketsPorDestino as $destino => $lineasDestino) {
            $ticket = [
                'destino' => $destino,
                'mesa' => $mesa['NOMBRE_MESA'] ?? 'Mesa ' . $id,
                'fecha' => date('d/m/Y H:i'),
                'lineas' => $lineasDestino,
                'total' => array_reduce($lineasDestino, fn($s, $l) => $s + ($l['UNIDS'] * $l['PV_LIN']), 0)
            ];
            $tickets[] = $ticket;
        }

        sendJson(['success' => true, 'tickets' => $tickets]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function borrarLineasCanceladas() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $comanda = $body['comanda'] ?? '';

    if (!$id || !$comanda) {
        sendError('El ID de la mesa y la comanda son obligatorios', 400);
    }

    try {
        $stmt = $pdo->prepare('CALL BORRAR_LINEAS_CANCELADAS(?)');
        $stmt->execute([(int)$comanda]);
        sendJson(['success' => true]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function actualizarLinea() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $producto_id = $body['producto_id'] ?? '';
    $cantidad = (int)($body['cantidad'] ?? 0);
    $comanda_id = $body['comanda_id'] ?? null;

    if (!$id || !$producto_id || !$comanda_id) {
        sendError('id, producto_id y comanda_id son obligatorios', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT MESA FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            sendError('Mesa no encontrada', 403);
        }

        $stmt = $pdo->prepare('SELECT * FROM ARTICULOS WHERE REF = ? AND ACTIVO = 1');
        $stmt->execute([$producto_id]);
        $articulo = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$articulo) {
            sendError('Artículo no encontrado', 404);
        }

        $stmt = $pdo->prepare('SELECT LINEA FROM LINEAS WHERE REF_LIN = ? AND MESA_LIN = ? AND COMANDA_LIN = ? AND TEXTO_LIN = ?');
        $stmt->execute([$producto_id, $id, $comanda_id, $articulo['TEXTO_ARTICULO']]);
        $linea = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($linea) {
            if ($cantidad <= 0) {
                $stmt = $pdo->prepare('DELETE FROM LINEAS WHERE LINEA = ?');
                $stmt->execute([$linea['LINEA']]);
            } else {
                $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = ? WHERE LINEA = ?');
                $stmt->execute([$cantidad, $linea['LINEA']]);
            }
        } elseif ($cantidad > 0) {
            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, ?, ?, 0, ?, "EN CURSO")');
            $stmt->execute([
                $comanda_id,
                $id,
                $producto_id,
                $articulo['TEXTO_ARTICULO'],
                $cantidad,
                $articulo['PV'],
                $articulo['PV'] * $cantidad
            ]);
        }

        $stmt = $pdo->prepare("SELECT l.LINEA AS id, l.REF_LIN AS producto_id, l.UNIDS AS cantidad, l.PV_LIN AS precio_unitario, l.ESTADO_LIN AS estado, l.TEXTO_LIN AS producto_nombre, (l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND l.COMANDA_LIN = ? ORDER BY l.ESTADO_LIN ASC");
        $stmt->execute([$id, $comanda_id]);
        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function obtenerSiguienteNumeroFactura() {
    global $pdo;
    $stmt = $pdo->query('SELECT COALESCE(MAX(NUM_FACTURA), 0) + 1 FROM FACTURAS');
    return (int)$stmt->fetchColumn();
}

function guardarFactura(int $numFactura, int $mesaId, string $mesaNombre, float $total, string $metodoPago, string $camarero, string $abiertoPor, $fechaApertura, array $lineas) {
    global $pdo;
    $stmt = $pdo->prepare('INSERT INTO FACTURAS (NUM_FACTURA, MESA_ID, MESA_NOMBRE, TOTAL, METODO_PAGO, CAMARERO, ABIERTO_POR, FECHA_APERTURA, LINEAS_JSON) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $numFactura,
        $mesaId,
        $mesaNombre,
        $total,
        $metodoPago,
        $camarero,
        $abiertoPor,
        $fechaApertura,
        json_encode($lineas, JSON_UNESCAPED_UNICODE),
    ]);
}

function cobrarMesa() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $items = $body['items'] ?? [];
    $todo = filter_var($body['todo'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $esFactura = filter_var($body['factura'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $metodoPago = trim($body['metodo_pago'] ?? 'efectivo');
    $camarero = trim($body['dispositivo'] ?? 'Sin nombre');

    if (!$id) {
        sendError('ID es obligatorio', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT TOTAL_PTE FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $mesa = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$mesa) {
            sendError('Mesa no encontrada', 403);
        }

        $pdo->beginTransaction();
        $ticketLineas = [];

        if ($todo) {
            $stmt = $pdo->prepare("SELECT l.REF_LIN AS producto_id, MAX(l.TEXTO_LIN) AS nombre, l.PV_LIN AS precio, SUM(l.UNIDS) AS cantidad, SUM(l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND COALESCE(l.ESTADO_LIN,'') != 'PAGADO' GROUP BY l.REF_LIN, l.PV_LIN");
            $stmt->execute([$id]);
            $ticketLineas = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $stmt = $pdo->prepare("UPDATE LINEAS SET ESTADO_LIN = 'PAGADO' WHERE MESA_LIN = ? AND COALESCE(ESTADO_LIN,'') != 'PAGADO'");
            $stmt->execute([$id]);

            // Usar procedimiento para cambiar a COBRADA
            $stmt = $pdo->prepare('CALL CAMBIAR_ESTADO_MESA(?, "COBRADA", "")');
            $stmt->execute([$id]);
            
            $stmt = $pdo->prepare('UPDATE MESAS SET TOTAL_PTE = 0, ABIERTO_POR = NULL, FECHA_APERTURA = NOW() WHERE MESA = ?');
            $stmt->execute([$id]);
        } else {
            $computed = array_reduce($items, fn($s, $i) => $s + (($i['cantidad'] ?? 0) * ($i['precio_unitario'] ?? 0)), 0);
            $useTotal = $computed > 0 ? $computed : floatval($body['total'] ?? 0);

            if ($useTotal <= 0) {
                $pdo->commit();
                sendJson(['success' => true]);
            }

            $paid = 0.0;
            if (!empty($items) && isset($items[0]['producto_id'])) {
                foreach ($items as $it) {
                    $qtyToPay = (int)($it['cantidad'] ?? 0);
                    $pid = $it['producto_id'];

                    while ($qtyToPay > 0) {
                        $stmt = $pdo->prepare('SELECT l.*, a.TEXTO_ARTICULO AS articulo_nombre FROM LINEAS l JOIN ARTICULOS a ON a.REF = l.REF_LIN WHERE l.MESA_LIN = ? AND l.REF_LIN = ? AND COALESCE(l.ESTADO_LIN,"") != "PAGADO" ORDER BY CASE WHEN l.ESTADO_LIN IN ("SERVIDO","EN CURSO") THEN 0 WHEN l.ESTADO_LIN = "PEDIDO" THEN 1 ELSE 2 END, l.COMANDA_LIN ASC, l.LINEA ASC LIMIT 1');
                        $stmt->execute([$id, $pid]);
                        $lin = $stmt->fetch(PDO::FETCH_ASSOC);
                        if (!$lin) break;

                        $lineaId = $lin['LINEA'];
                        $unids = (int)$lin['UNIDS'];
                        $pv = floatval($lin['PV_LIN']);

                        if ($unids <= $qtyToPay) {
                            $stmt = $pdo->prepare('UPDATE LINEAS SET ESTADO_LIN = "PAGADO" WHERE LINEA = ?');
                            $stmt->execute([$lineaId]);
                            $paid += $unids * $pv;
                            agregarLineaTicket($ticketLineas, $pid, $lin['articulo_nombre'], $pv, $unids);
                            $qtyToPay -= $unids;
                        } else {
                            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = UNIDS - ? WHERE LINEA = ?');
                            $stmt->execute([$qtyToPay, $lineaId]);

                            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "PAGADO")');
                            $stmt->execute([
                                $lin['COMANDA_LIN'], $lin['MESA_LIN'], $lin['REF_LIN'], $lin['TEXTO_LIN'], $qtyToPay, $lin['PV_LIN'], $lin['IVA_LIN'], $lin['BASE_LIN'] * ($qtyToPay / max(1, $unids))
                            ]);

                            $paid += $qtyToPay * $pv;
                            agregarLineaTicket($ticketLineas, $pid, $lin['articulo_nombre'], $pv, $qtyToPay);
                            $qtyToPay = 0;
                        }
                    }
                }
            }

            if ($paid < $useTotal) {
                $remaining = $useTotal - $paid;
                while ($remaining > 0) {
                    $stmt = $pdo->prepare('SELECT l.*, a.TEXTO_ARTICULO AS articulo_nombre FROM LINEAS l JOIN ARTICULOS a ON a.REF = l.REF_LIN WHERE l.MESA_LIN = ? AND COALESCE(l.ESTADO_LIN,"") != "PAGADO" ORDER BY l.COMANDA_LIN ASC, l.LINEA ASC LIMIT 1');
                    $stmt->execute([$id]);
                    $lin = $stmt->fetch(PDO::FETCH_ASSOC);
                    if (!$lin) break;

                    $lineaId = $lin['LINEA'];
                    $unids = (int)$lin['UNIDS'];
                    $pv = floatval($lin['PV_LIN']);
                    $lineTotal = $unids * $pv;

                    if ($lineTotal <= $remaining + 0.0001) {
                        $stmt = $pdo->prepare('UPDATE LINEAS SET ESTADO_LIN = "PAGADO" WHERE LINEA = ?');
                        $stmt->execute([$lineaId]);
                        $paid += $lineTotal;
                        agregarLineaTicket($ticketLineas, $lin['REF_LIN'], $lin['articulo_nombre'], $pv, $unids);
                        $remaining -= $lineTotal;
                    } else {
                        $unitsToPay = (int)floor($remaining / max(0.000001, $pv));
                        if ($unitsToPay <= 0) $unitsToPay = 1;

                        if ($unitsToPay >= $unids) {
                            $stmt = $pdo->prepare('UPDATE LINEAS SET ESTADO_LIN = "PAGADO" WHERE LINEA = ?');
                            $stmt->execute([$lineaId]);
                            $paid += $unids * $pv;
                            agregarLineaTicket($ticketLineas, $lin['REF_LIN'], $lin['articulo_nombre'], $pv, $unids);
                            $remaining -= $unids * $pv;
                        } else {
                            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = UNIDS - ? WHERE LINEA = ?');
                            $stmt->execute([$unitsToPay, $lineaId]);

                            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "PAGADO")');
                            $stmt->execute([
                                $lin['COMANDA_LIN'], $lin['MESA_LIN'], $lin['REF_LIN'], $lin['TEXTO_LIN'], $unitsToPay, $lin['PV_LIN'], $lin['IVA_LIN'], $lin['BASE_LIN'] * ($unitsToPay / max(1, $unids))
                            ]);

                            $paid += $unitsToPay * $pv;
                            agregarLineaTicket($ticketLineas, $lin['REF_LIN'], $lin['articulo_nombre'], $pv, $unitsToPay);
                            $remaining -= $unitsToPay * $pv;
                        }
                    }
                }
            }

            $stmt = $pdo->prepare('UPDATE MESAS SET TOTAL_PTE = GREATEST(0, TOTAL_PTE - ?) WHERE MESA = ?');
            $stmt->execute([$paid, $id]);

            // Verificar si después de cobrar esta parte, la mesa ya no tiene nada pendiente
            $stmt = $pdo->prepare('SELECT SUM(UNIDS * PV_LIN) FROM LINEAS WHERE MESA_LIN = ? AND COALESCE(ESTADO_LIN, "") != "PAGADO"');
            $stmt->execute([$id]);
            $totalRestanteReal = floatval($stmt->fetchColumn() ?: 0);

            if ($totalRestanteReal <= 0.001) {
                // Usar procedimiento CAMBIAR_ESTADO_MESA para marcar como COBRADA
                $stmt = $pdo->prepare('CALL CAMBIAR_ESTADO_MESA(?, "COBRADA", "")');
                $stmt->execute([$id]);
                
                // Limpiar TOTAL_PTE y ABIERTO_POR
                $stmt = $pdo->prepare('UPDATE MESAS SET TOTAL_PTE = 0, ABIERTO_POR = NULL, FECHA_APERTURA = NOW() WHERE MESA = ?');
                $stmt->execute([$id]);
            }
        }

        $pdo->commit();

        $stmt = $pdo->prepare('SELECT NOMBRE_MESA FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $mesaNombre = $stmt->fetchColumn();

        $stmt = $pdo->prepare('SELECT SUM(l.UNIDS * l.PV_LIN) AS TOTAL_PTE FROM LINEAS l WHERE l.MESA_LIN = ? AND COALESCE(l.ESTADO_LIN, "") != "PAGADO"');
        $stmt->execute([$id]);
        $mesaPendiente = floatval($stmt->fetchColumn() ?: 0);

        $ticket = [
            'mesa' => $mesaNombre,
            'fecha' => date('d/m/Y H:i:s'),
            'lineas' => array_map(function ($linea) {
                return [
                    'nombre' => $linea['nombre'],
                    'cantidad' => (int)$linea['cantidad'],
                    'precio' => floatval($linea['precio']),
                    'subtotal' => floatval($linea['subtotal']),
                ];
            }, $ticketLineas),
            'total' => number_format(array_reduce($ticketLineas, fn($s, $l) => $s + floatval($l['subtotal']), 0), 2, '.', ''),
            'titulo' => 'Ticket de cobro',
        ];

        $response = [
            'success' => true,
            'ticket' => $ticket,
            'mesa_cobrada' => $mesaPendiente <= 0,
            'mesa_pendiente' => $mesaPendiente,
        ];

        // Consultar todas las líneas PAGADAS de la mesa (para factura y ticket completo)
        $stmt = $pdo->prepare('SELECT a.TEXTO_ARTICULO AS nombre, l.REF_LIN AS producto_id, SUM(l.UNIDS) AS cantidad, l.PV_LIN AS precio, SUM(l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l JOIN ARTICULOS a ON a.REF = l.REF_LIN WHERE l.MESA_LIN = ? AND l.ESTADO_LIN = "PAGADO" GROUP BY l.REF_LIN, l.PV_LIN ORDER BY nombre ASC');
        $stmt->execute([$id]);
        $lineasCompletas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $ticketCompleto = [
            'mesa' => $mesaNombre,
            'fecha' => date('d/m/Y H:i:s'),
            'lineas' => array_map(function ($linea) {
                return [
                    'nombre' => $linea['nombre'],
                    'cantidad' => (int)$linea['cantidad'],
                    'precio' => floatval($linea['precio']),
                    'subtotal' => floatval($linea['subtotal']),
                ];
            }, $lineasCompletas),
            'total' => number_format(array_reduce($lineasCompletas, fn($s, $l) => $s + floatval($l['subtotal']), 0), 2, '.', ''),
            'titulo' => 'Ticket completo de mesa',
        ];

        // Solo incluir ticket_completo si la mesa quedó totalmente cobrada (sin pendiente)
        if ($mesaPendiente <= 0) {
            $response['ticket_completo'] = $ticketCompleto;
        }

        // --- FACTURA ---
        if ($esFactura) {
            // Obtener datos de la mesa
            $stmt = $pdo->prepare('SELECT NOMBRE_MESA, ABIERTO_POR, FECHA_APERTURA FROM MESAS WHERE MESA = ?');
            $stmt->execute([$id]);
            $datosMesa = $stmt->fetch(PDO::FETCH_ASSOC);

            $numFactura = obtenerSiguienteNumeroFactura();
            $abiertoPor = $camarero; // camarero = nombre del dispositivo

            // Factura SIEMPRE con TODAS las líneas pagadas (incluye las que ya estaban cobradas)
            $lineasFactura = $ticketCompleto['lineas'];
            $totalFactura = floatval($ticketCompleto['total']);

            $facturaData = [
                'num_factura' => $numFactura,
                'mesa' => $mesaNombre,
                'fecha' => date('d/m/Y H:i:s'),
                'lineas' => $lineasFactura,
                'total' => $totalFactura,
                'metodo_pago' => $metodoPago,
                'camarero' => $camarero,
                'abierto_por' => $abiertoPor,
                'fecha_apertura' => $datosMesa['FECHA_APERTURA'] ?? null,
            ];

            // Guardar en BD
            guardarFactura(
                $numFactura,
                (int)$id,
                $mesaNombre,
                $totalFactura,
                $metodoPago,
                $camarero,
                $abiertoPor,
                $datosMesa['FECHA_APERTURA'] ?? null,
                $lineasFactura
            );

            $response['factura'] = $facturaData;
        }

        sendJson($response);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        sendError($e->getMessage(), 500);
    }
}

function agregarComentario() {
    global $pdo;
    $body = getJsonBody();

    $linea_id = $body['linea_id'] ?? null;
    $comentario = trim($body['comentario'] ?? '');
    $mesa_id = $body['mesa_id'] ?? null;
    $comanda_id = $body['comanda_id'] ?? null;

    if (!$linea_id || !$comentario || !$mesa_id || !$comanda_id) {
        sendError('Faltan parámetros', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT * FROM LINEAS WHERE LINEA = ? AND MESA_LIN = ?');
        $stmt->execute([$linea_id, $mesa_id]);
        $linea = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$linea) {
            sendError('Línea no encontrada', 404);
        }

        $textoBase = $linea['TEXTO_LIN'];
        $nuevoTexto = strtoupper($textoBase . ' ' . $comentario);
        $unidsActuales = (int)$linea['UNIDS'];

        // Restar 1 de la original
        if ($unidsActuales <= 1) {
            // Si quedaba 1, borrar la línea
            $stmt = $pdo->prepare('DELETE FROM LINEAS WHERE LINEA = ?');
            $stmt->execute([$linea_id]);
        } else {
            // Si quedaban más, restar 1
            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = UNIDS - 1 WHERE LINEA = ?');
            $stmt->execute([$linea_id]);
        }

        // Crear nueva línea con comentario
        $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)');
        $stmt->execute([
            $comanda_id,
            $mesa_id,
            $linea['REF_LIN'],
            $nuevoTexto,
            $linea['PV_LIN'],
            $linea['IVA_LIN'],
            $linea['BASE_LIN'] / max(1, $unidsActuales),
            $linea['ESTADO_LIN'],
        ]);

        $stmt = $pdo->prepare('SELECT l.LINEA AS id, l.REF_LIN AS producto_id, l.UNIDS AS cantidad, l.PV_LIN AS precio_unitario, l.ESTADO_LIN AS estado, l.TEXTO_LIN AS producto_nombre, l.COMANDA_LIN AS comanda_id, (l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND l.COMANDA_LIN = ? ORDER BY l.ESTADO_LIN ASC');
        $stmt->execute([$mesa_id, $comanda_id]);
        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function actualizarLineaPorId() {
    global $pdo;
    $body = getJsonBody();

    $linea_id = $body['linea_id'] ?? null;
    $cantidad = (int)($body['cantidad'] ?? 0);
    $mesa_id = $body['mesa_id'] ?? null;
    $comanda_id = $body['comanda_id'] ?? null;

    if (!$linea_id || !$mesa_id || !$comanda_id) {
        sendError('Faltan parámetros', 400);
    }

    try {
        if ($cantidad <= 0) {
            $stmt = $pdo->prepare('DELETE FROM LINEAS WHERE LINEA = ? AND MESA_LIN = ?');
            $stmt->execute([$linea_id, $mesa_id]);
        } else {
            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = ? WHERE LINEA = ? AND MESA_LIN = ?');
            $stmt->execute([$cantidad, $linea_id, $mesa_id]);
        }

        $stmt = $pdo->prepare('SELECT l.LINEA AS id, l.REF_LIN AS producto_id, l.UNIDS AS cantidad, l.PV_LIN AS precio_unitario, l.ESTADO_LIN AS estado, l.TEXTO_LIN AS producto_nombre, l.COMANDA_LIN AS comanda_id, (l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND l.COMANDA_LIN = ? ORDER BY l.ESTADO_LIN ASC');
        $stmt->execute([$mesa_id, $comanda_id]);
        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function repetirLinea() {
    global $pdo;
    $body = getJsonBody();

    $mesa_id = $body['mesa_id'] ?? null;
    $comanda_id = $body['comanda_id'] ?? null;
    $producto_id = $body['producto_id'] ?? null;
    $texto = $body['texto'] ?? null;

    if (!$mesa_id || !$comanda_id || !$producto_id || !$texto) {
        sendError('Faltan parámetros', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT PV_LIN, IVA_LIN FROM LINEAS WHERE REF_LIN = ? AND MESA_LIN = ? LIMIT 1');
        $stmt->execute([$producto_id, $mesa_id]);
        $ref = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$ref) {
            sendError('Producto no encontrado', 404);
        }

        $stmt = $pdo->prepare('SELECT LINEA, UNIDS FROM LINEAS WHERE MESA_LIN = ? AND COMANDA_LIN = ? AND TEXTO_LIN = ? AND REF_LIN = ?');
        $stmt->execute([$mesa_id, $comanda_id, $texto, $producto_id]);
        $existe = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($existe) {
            $stmt = $pdo->prepare('UPDATE LINEAS SET UNIDS = UNIDS + 1 WHERE LINEA = ?');
            $stmt->execute([$existe['LINEA']]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, 1, ?, ?, ?, "EN CURSO")');
            $stmt->execute([
                $comanda_id,
                $mesa_id,
                $producto_id,
                $texto,
                $ref['PV_LIN'],
                $ref['IVA_LIN'],
                $ref['PV_LIN'],
            ]);
        }

        $stmt = $pdo->prepare('SELECT l.LINEA AS id, l.REF_LIN AS producto_id, l.UNIDS AS cantidad, l.PV_LIN AS precio_unitario, l.ESTADO_LIN AS estado, l.TEXTO_LIN AS producto_nombre, l.COMANDA_LIN AS comanda_id, (l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND l.COMANDA_LIN = ? ORDER BY l.ESTADO_LIN ASC');
        $stmt->execute([$mesa_id, $comanda_id]);
        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function restaurarMesa() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? '';
    $lineas = $body['lineas'] ?? [];

    if (!$id) {
        sendError('Faltan parámetros', 401);
    }

    try {
        $stmt = $pdo->prepare('SELECT MESA FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            sendError('Acceso denegado', 403);
        }

        $stmt = $pdo->prepare('DELETE FROM LINEAS WHERE MESA_LIN = ?');
        $stmt->execute([$id]);

        $stmt = $pdo->prepare('SELECT COMANDA FROM COMANDAS WHERE MESA_COM = ? ORDER BY FECHA_COM DESC LIMIT 1');
        $stmt->execute([$id]);
        $comanda = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$comanda) {
            $stmt = $pdo->prepare('INSERT INTO COMANDAS (MESA_COM, NOMBRE_COM, FECHA_COM) VALUES (?, ?, NOW())');
            $stmt->execute([$id, 'Comanda mesa ' . $id]);
            $comanda_id = $pdo->lastInsertId();
        } else {
            $comanda_id = $comanda['COMANDA'];
        }

        foreach ($lineas as $l) {
            $stmt = $pdo->prepare('INSERT INTO LINEAS (COMANDA_LIN, MESA_LIN, REF_LIN, TEXTO_LIN, UNIDS, PV_LIN, IVA_LIN, BASE_LIN, ESTADO_LIN) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)');
            $stmt->execute([
                $comanda_id,
                $id,
                $l['producto_id'],
                $l['producto_nombre'],
                $l['cantidad'],
                $l['precio_unitario'],
                $l['precio_unitario'] * $l['cantidad'],
                $l['estado'] ?? 'EN CURSO',
            ]);
        }

        sendJson(['success' => true]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function resumenMesas() {
    global $pdo;
    try {
        $stmt = $pdo->query("SELECT 
            m.MESA,
            m.NOMBRE_MESA AS NOMBRE,
            m.ESTADO_MESA AS ESTADO,
            m.ABIERTO_POR,
            COALESCE(SUM(l.UNIDS * l.PV_LIN), 0) AS TOTAL,
            COALESCE(SUM(CASE WHEN l.ESTADO_LIN != 'PAGADO' THEN l.UNIDS * l.PV_LIN ELSE 0 END), 0) AS TOTAL_PTE,
            COALESCE(SUM(CASE WHEN l.ESTADO_LIN != 'PAGADO' THEN l.UNIDS ELSE 0 END), 0) AS NUM_ARTICULOS
        FROM MESAS m
        LEFT JOIN LINEAS l ON l.MESA_LIN = m.MESA
        GROUP BY m.MESA, m.NOMBRE_MESA, m.ESTADO_MESA, m.ABIERTO_POR");

        sendJson($stmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function detalleMesa() {
    global $pdo;
    $id = getRequestParam('id');
    $comanda_id = getRequestParam('comanda');

    if (!$id) {
        sendError('id es obligatoria', 401);
    }

    try {
        $stmt = $pdo->prepare('SELECT * FROM MESAS WHERE MESA = ?');
        $stmt->execute([$id]);
        $mesa = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$mesa) {
            sendError('Acceso denegado', 403);
        }

        $stmt = $pdo->prepare("SELECT l.LINEA AS id, l.REF_LIN AS producto_id, l.UNIDS AS cantidad, l.PV_LIN AS precio_unitario, l.ESTADO_LIN AS estado, l.TEXTO_LIN AS producto_nombre, l.COMANDA_LIN AS comanda_id, (l.UNIDS * l.PV_LIN) AS subtotal FROM LINEAS l WHERE l.MESA_LIN = ? AND l.ESTADO_LIN <> 'PAGADO' ORDER BY CASE l.ESTADO_LIN WHEN 'PEDIDO' THEN 1 WHEN 'EN CURSO' THEN 2 WHEN 'LISTO' THEN 3 WHEN 'SERVIDO' THEN 4 ELSE 5 END ASC, l.COMANDA_LIN ASC");
        $stmt->execute([$id]);
        $lineas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if ($comanda_id === null || $comanda_id === '') {
            $actual = $lineas;
            $anterior = [];
        } else {
            $actual = array_values(array_filter($lineas, function ($l) use ($comanda_id) {
                return $l['comanda_id'] == $comanda_id;
            }));

            $anterior = array_values(array_filter($lineas, function ($l) use ($comanda_id) {
                return $l['comanda_id'] != $comanda_id;
            }));
        }

        $anteriorAgrupadas = [];
        foreach ($anterior as $l) {
            $key = $l['producto_id'] . '_' . $l['estado'] . '_' . $l['producto_nombre'];
            if (!isset($anteriorAgrupadas[$key])) {
                $anteriorAgrupadas[$key] = $l;
            } else {
                $anteriorAgrupadas[$key]['cantidad'] += (int)$l['cantidad'];
                $anteriorAgrupadas[$key]['subtotal'] += (float)$l['subtotal'];
            }
        }

        sendJson([
            'mesa' => $mesa,
            'lineas' => $actual,
            'lineas_anteriores' => array_values($anteriorAgrupadas)
        ]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function lineasCobro() {
    global $pdo;
    $id = getRequestParam('id');

    if (!$id) {
        sendError('id es obligatorio', 400);
    }

    try {
        $stmt = $pdo->prepare("SELECT l.REF_LIN AS producto_id,
                a.TEXTO_ARTICULO AS producto_nombre,
                l.PV_LIN AS precio_unitario,
                SUM(CASE WHEN l.ESTADO_LIN IN ('SERVIDO','EN CURSO') THEN l.UNIDS ELSE 0 END) AS cantidad_total,
                SUM(CASE WHEN l.ESTADO_LIN = 'PAGADO' THEN l.UNIDS ELSE 0 END) AS cantidad_pagada,
                SUM(CASE WHEN l.ESTADO_LIN IN ('SERVIDO','EN CURSO') THEN l.UNIDS * l.PV_LIN ELSE 0 END) AS subtotal
            FROM LINEAS l
            JOIN ARTICULOS a ON a.REF = l.REF_LIN
            WHERE l.MESA_LIN = ? AND l.ESTADO_LIN IN ('SERVIDO','EN CURSO','PAGADO')
            GROUP BY l.REF_LIN, l.PV_LIN, a.TEXTO_ARTICULO
            ORDER BY producto_nombre ASC");
        $stmt->execute([$id]);
        $lineas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare('SELECT SUM(l.UNIDS * l.PV_LIN) AS TOTAL_PTE FROM LINEAS l WHERE l.MESA_LIN = ? AND COALESCE(l.ESTADO_LIN, "") != "PAGADO"');
        $stmt->execute([$id]);
        $mesa = $stmt->fetch(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare('SELECT l.COMANDA_LIN AS comanda_id FROM LINEAS l WHERE l.MESA_LIN = ? AND COALESCE(l.ESTADO_LIN, "") != "PAGADO" ORDER BY l.COMANDA_LIN DESC LIMIT 1');
        $stmt->execute([$id]);
        $comanda = $stmt->fetch(PDO::FETCH_ASSOC);

        sendJson([
            'lineas' => $lineas,
            'total_pte' => $mesa['TOTAL_PTE'] ?? 0,
            'comanda_id' => $comanda['comanda_id'] ?? null
        ]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function estadoMesa() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? null;
    $estado = $body['estado'] ?? null;

    if (!$id || !$estado) {
        sendError('Faltan datos', 400);
    }

    try {
        // Si el estado es COBRADA, también limpiar ABIERTO_POR y TOTAL_PTE
        if ($estado === 'COBRADA') {
            $stmt = $pdo->prepare('UPDATE MESAS SET ESTADO_MESA = ?, ABIERTO_POR = NULL, TOTAL_PTE = 0 WHERE MESA = ?');
            $stmt->execute([$estado, $id]);
        } else {
            $stmt = $pdo->prepare('UPDATE MESAS SET ESTADO_MESA = ? WHERE MESA = ?');
            $stmt->execute([$estado, $id]);
        }
        sendJson(['success' => true]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function renombrarMesa() {
    global $pdo;
    $body = getJsonBody();

    $id = $body['id'] ?? null;
    $nombre = $body['nombre'] ?? null;

    if (!$id || !$nombre) {
        sendError('Faltan datos: id y nombre requeridos', 400);
    }

    try {
        $stmt = $pdo->prepare('UPDATE MESAS SET NOMBRE_MESA = ? WHERE MESA = ?');
        $stmt->execute([$nombre, $id]);
        sendJson(['success' => true]);
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

function obtenerMesasDisponiblesConLineas() {
    global $pdo;
    
    try {
        $mesaActiva = (int)($_GET['mesa_activa'] ?? $_POST['mesa_activa'] ?? 0);
        
        $sql = "SELECT m.MESA, m.NOMBRE_MESA, m.ESTADO_MESA, m.ABIERTO_POR
                FROM MESAS m
                WHERE m.ESTADO_MESA != 'COBRADA'";
        
        if ($mesaActiva > 0) {
            $sql .= " AND m.MESA != $mesaActiva";
        }
        
        $stmt = $pdo->query($sql);
        $mesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $result = [];
        
        foreach ($mesas as $m) {
            $id = (int)$m['MESA'];
            
            // Obtener líneas NO pagadas
            $sqlLin = "SELECT l.REF_LIN, l.TEXTO_LIN, l.UNIDS, l.PV_LIN, l.COMANDA_LIN
                       FROM LINEAS l
                       WHERE l.MESA_LIN = $id AND COALESCE(l.ESTADO_LIN,'') != 'PAGADO'";
            
            $stmtLin = $pdo->query($sqlLin);
            $lineas = $stmtLin->fetchAll(PDO::FETCH_ASSOC);
            
            if (count($lineas) == 0) {
                continue;
            }
            
            $total = 0;
            $lineasFormato = [];
            
            foreach ($lineas as $lin) {
                $unids = (int)$lin['UNIDS'];
                $precio = (float)$lin['PV_LIN'];
                $subtotal = $unids * $precio;
                $total += $subtotal;
                
                $lineasFormato[] = [
                    'producto_id' => (int)$lin['REF_LIN'],
                    'producto_nombre' => (string)$lin['TEXTO_LIN'],
                    'cantidad_total' => $unids,
                    'cantidad_pagada' => 0,
                    'precio_unitario' => $precio,
                    'comanda_id' => (int)$lin['COMANDA_LIN']
                ];
            }
            
            if ($total > 0) {
                $result[] = [
                    'mesa' => $id,
                    'nombre' => (string)$m['NOMBRE_MESA'],
                    'estado' => (string)$m['ESTADO_MESA'],
                    'total_pte' => $total,
                    'abierto_por' => $m['ABIERTO_POR'],
                    'lineas' => $lineasFormato
                ];
            }
        }
        
        sendJson($result);
        
    } catch (Throwable $e) {
        sendError($e->getMessage(), 500);
    }
}

$action = $_REQUEST['action'] ?? null;
$method = $_SERVER['REQUEST_METHOD'];

if ($action === null) {
    if ($method === 'GET') {
        listarMesas();
    }
    if ($method === 'POST') {
        crearMesa();
    }
    sendError('Método no permitido', 405);
}

switch ($action) {
    case 'listar':
        listarMesas();
        break;
    case 'crear':
        crearMesa();
        break;
    case 'entrar':
        entrarMesa();
        break;
    case 'guardar':
        guardarYSalir();
        break;
    case 'salir':
        borrarLineasCanceladas();
        break;
    case 'linea':
        actualizarLinea();
        break;
    case 'cobrar':
        cobrarMesa();
        break;
    case 'comentario':
        agregarComentario();
        break;
    case 'linea_id':
        actualizarLineaPorId();
        break;
    case 'mesas_disponibles_con_lineas':
        obtenerMesasDisponiblesConLineas();
        break;
    case 'repetir':
        repetirLinea();
        break;
    case 'restaurar':
        restaurarMesa();
        break;
    case 'resumen':
        resumenMesas();
        break;
    case 'detalle':
        detalleMesa();
        break;
    case 'lineas_cobro':
        lineasCobro();
        break;
    case 'estado':
        estadoMesa();
        break;
    case 'renombrar':
        renombrarMesa();
        break;
    default:
        sendError('Acción desconocida', 400);
}
