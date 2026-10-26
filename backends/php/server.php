<?php
// Backend PHP — RAG Extractor
// Servir com:  php -S localhost:8001 server.php
// Diretório de saída: ./rag-store (configurável via env RAG_ROOT)

declare(strict_types=1);

$ROOT = realpath(getenv('RAG_ROOT') ?: __DIR__ . '/rag-store');
if (!$ROOT) {
    $ROOT = __DIR__ . '/rag-store';
    @mkdir($ROOT, 0755, true);
    $ROOT = realpath($ROOT);
}
$TOKEN = getenv('RAG_TOKEN') ?: '';

// CORS — extensão Chrome roda em chrome-extension://* (origin)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (preg_match('#^chrome-extension://[a-p]{32}$#', $origin)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function check_auth(string $token): void {
    if ($token === '') return;
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($h !== "Bearer $token") {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'invalid token']);
        exit;
    }
}

function safe_path(string $root, string $filename): string {
    if (strpos($filename, '..') !== false || $filename[0] === '/') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid filename']);
        exit;
    }
    if (!preg_match('#^[\w\-./]+\.md$#', $filename)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'filename must be safe + end with .md']);
        exit;
    }
    $full = $root . '/' . $filename;
    $dir = dirname($full);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    return $full;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Roteador minimalista
if ($path === '/' && $method === 'GET') {
    echo json_encode(['ok' => true, 'service' => 'rag-extractor', 'root' => $ROOT]);
    exit;
}

if ($path === '/rag/ingest' && $method === 'POST') {
    check_auth($TOKEN);
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body) || empty($body['filename']) || !isset($body['markdown'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'filename and markdown required']);
        exit;
    }
    $full = safe_path($ROOT, $body['filename']);
    file_put_contents($full, $body['markdown']);
    echo json_encode([
        'ok' => true,
        'path' => $full,
        'bytes' => filesize($full),
        'savedAt' => gmdate('c'),
    ]);
    exit;
}

if ($path === '/rag/list' && $method === 'GET') {
    check_auth($TOKEN);
    $items = [];
    if (is_dir($ROOT)) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($ROOT));
        foreach ($it as $f) {
            if ($f->isFile() && $f->getExtension() === 'md') {
                $items[] = [
                    'filename' => ltrim(str_replace($ROOT, '', $f->getPathname()), '/'),
                    'size' => $f->getSize(),
                    'modified' => gmdate('c', $f->getMTime()),
                ];
            }
        }
    }
    usort($items, fn($a, $b) => strcmp($b['modified'], $a['modified']));
    echo json_encode(['ok' => true, 'items' => $items]);
    exit;
}

if (preg_match('#^/rag/(.+)$#', $path, $m) && $method === 'DELETE') {
    check_auth($TOKEN);
    $full = safe_path($ROOT, $m[1]);
    if (file_exists($full)) { unlink($full); echo json_encode(['ok' => true]); exit; }
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not found']);
    exit;
}

http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'route not found']);
