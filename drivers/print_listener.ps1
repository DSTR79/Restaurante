# ============================================
# POS-80C Print Listener
# Puerto 9100 - Imprime tickets sin dialogo
# ============================================

param(
    [int]$Port = 9100,
    [string]$PrinterName = "POS-80C"
)

# Cargar System.Drawing desde GAC
$asmPath = [System.IO.Path]::Combine($env:SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'System.Drawing.dll')
if (Test-Path $asmPath) {
    [System.Reflection.Assembly]::LoadFrom($asmPath) | Out-Null
}

# P/Invoke para impresion directa via winspool
if (-not ([System.Management.Automation.PSTypeName]'RawPrint').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
public struct DOCINFO {
    public string pDocName;
    public string pOutputFile;
    public string pDatatype;
}

public class RawPrint {
    [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool PrintRaw(string printerName, string text) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            return false;

        try {
            var doc = new DOCINFO();
            doc.pDocName = "Ticket";
            doc.pOutputFile = null;
            doc.pDatatype = "RAW";

            StartDocPrinter(hPrinter, 1, ref doc);
            StartPagePrinter(hPrinter);

            // Texto del ticket en bytes ASCII
            byte[] textBytes = Encoding.ASCII.GetBytes(text);
            // ESC d 6 = avanzar 6 lineas antes de cortar (~7.5mm margen)
            // GS V 0 = corte completo
            byte[] cutCmd = new byte[] {
                0x1B, 0x64, 0x06,
                0x1D, 0x56, 0x00
            };

            // Combinar: texto + corte
            byte[] full = new byte[textBytes.Length + cutCmd.Length];
            Array.Copy(textBytes, 0, full, 0, textBytes.Length);
            Array.Copy(cutCmd, 0, full, textBytes.Length, cutCmd.Length);

            IntPtr pBytes = Marshal.AllocHGlobal(full.Length);
            Marshal.Copy(full, 0, pBytes, full.Length);
            int written = 0;
            WritePrinter(hPrinter, pBytes, full.Length, out written);
            Marshal.FreeHGlobal(pBytes);

            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
            return true;
        }
        finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:${Port}/")
$listener.Start()

Write-Host "=========================================="
Write-Host " POS-80C Print Listener activo"
Write-Host " Puerto: $Port | Impresora: $PrinterName"
Write-Host " URL: http://localhost:${Port}/print"
Write-Host "=========================================="
Write-Host "Esperando tickets... (Ctrl+C para detener)"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        if ($request.Url.AbsolutePath -eq "/print" -and $request.HttpMethod -eq "POST") {
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $body = $reader.ReadToEnd()
                $reader.Close()

                $data = $body | ConvertFrom-Json
                $ticketText = $data.text

                if (-not $ticketText) {
                    throw "Ticket vacio"
                }

                $ok = [RawPrint]::PrintRaw($PrinterName, $ticketText)

                if ($ok) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Ticket impreso OK" -ForegroundColor Green
                    $result = '{"success":true}'
                } else {
                    $response.StatusCode = 500
                    $result = '{"success":false,"error":"No se pudo abrir la impresora"}'
                }
            } catch {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $($_.Exception.Message)" -ForegroundColor Red
                $errMsg = $_.Exception.Message -replace '"', '\"'
                $result = "{`"success`":false,`"error`":`"$errMsg`"}"
                $response.StatusCode = 500
            }

            $buffer = [System.Text.Encoding]::UTF8.GetBytes($result)
            $response.ContentType = "application/json"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
        }
        elseif ($request.Url.AbsolutePath -eq "/ping") {
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("{`"ok`":true,`"printer`":`"$PrinterName`"}")
            $response.ContentType = "application/json"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
        }
        else {
            $response.StatusCode = 404
            $response.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host "Listener detenido."
}
