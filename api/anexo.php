<?php
// Upload, download e remoção do arquivo do contrato assinado anexado a um contrato.
// Os arquivos ficam em /contratos, protegidos por .htaccess — só este script
// (autenticado) pode lê-los ou gravá-los.
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

requireAuth();
ensureContratosDir();

$method = $_SERVER['REQUEST_METHOD'];

function anexoErro($status, $mensagem) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $mensagem]);
    exit;
}

// Garante que o nome do arquivo não escapa da pasta contratos/ (sem "/", "\" ou "..").
function nomeArquivoValido($nome) {
    return $nome !== '' && $nome === basename($nome) && strpos($nome, '..') === false;
}

if ($method === 'GET') {
    $file = (string)($_GET['file'] ?? '');
    if (!nomeArquivoValido($file)) anexoErro(400, 'Arquivo inválido.');

    $caminho = CONTRATOS_DIR . '/' . $file;
    if (!is_file($caminho)) anexoErro(404, 'Arquivo não encontrado.');

    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $mime = ANEXO_TIPOS_PERMITIDOS[$ext] ?? 'application/octet-stream';

    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="' . $file . '"');
    header('Content-Length: ' . filesize($caminho));
    readfile($caminho);
    exit;
}

if ($method === 'POST') {
    // Upload de um novo anexo (multipart/form-data)
    if (!empty($_FILES['arquivo'])) {
        $arquivo = $_FILES['arquivo'];
        $contratoId = (string)($_POST['contratoId'] ?? '');
        $inquilino = (string)($_POST['inquilino'] ?? '');
        $imovel = (string)($_POST['imovel'] ?? '');

        if ($contratoId === '') anexoErro(400, 'Contrato inválido.');
        if ($arquivo['error'] !== UPLOAD_ERR_OK) anexoErro(400, 'Falha no envio do arquivo.');
        if ($arquivo['size'] > ANEXO_TAMANHO_MAXIMO) anexoErro(400, 'Arquivo maior que o limite de 15MB.');

        $ext = strtolower(pathinfo($arquivo['name'], PATHINFO_EXTENSION));
        if (!isset(ANEXO_TIPOS_PERMITIDOS[$ext])) {
            anexoErro(400, 'Tipo de arquivo não permitido. Envie PDF, JPG ou PNG.');
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeReal = finfo_file($finfo, $arquivo['tmp_name']);
        if ($mimeReal !== ANEXO_TIPOS_PERMITIDOS[$ext]) {
            anexoErro(400, 'O conteúdo do arquivo não corresponde à extensão enviada.');
        }

        $sufixo = substr(preg_replace('/[^a-zA-Z0-9]/', '', $contratoId), -8);
        $nomeFinal = slugify($inquilino) . '-' . slugify($imovel) . '-' . $sufixo . '.' . $ext;
        $destino = CONTRATOS_DIR . '/' . $nomeFinal;

        if (!move_uploaded_file($arquivo['tmp_name'], $destino)) {
            anexoErro(500, 'Não foi possível salvar o arquivo no servidor.');
        }

        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true, 'filename' => $nomeFinal]);
        exit;
    }

    // Remoção de um anexo existente (JSON)
    $input = json_decode(file_get_contents('php://input'), true);
    if (is_array($input) && ($input['action'] ?? '') === 'remove') {
        $file = (string)($input['file'] ?? '');
        if (!nomeArquivoValido($file)) anexoErro(400, 'Arquivo inválido.');
        $caminho = CONTRATOS_DIR . '/' . $file;
        if (is_file($caminho)) unlink($caminho);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true]);
        exit;
    }

    anexoErro(400, 'Requisição inválida.');
}

http_response_code(405);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => false, 'error' => 'Método não permitido']);
