<?php
// Roteador para o servidor embutido do PHP, que ignora os .htaccess:
//   php -S localhost:8000 roteador-dev.php
// Sem ele, data/dados.json, data/auth.json e os anexos em contratos/ ficariam
// abertos pela URL. Em hospedagem com Apache este arquivo não é usado.
$caminho = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
if (preg_match('#(^|/)(data|contratos|tests|docs|\.git)(/|$)#i', $caminho)
    || preg_match('#(^|/)(agents\.md|etapas\.txt|README\.md|roteador-dev\.php)$#i', $caminho)) {
    http_response_code(404);
    echo 'Não encontrado.';
    return true;
}
return false; // o resto (index.html, api/*.php, css, js, imagens) segue normal
