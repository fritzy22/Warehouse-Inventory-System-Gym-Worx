<?php
// Generates static index.html from index.php directly via output buffering
$dir = dirname(__DIR__);
chdir($dir);
ob_start();
include $dir . '/index.php';
$html = ob_get_clean();

if ($html !== false && strlen($html) > 5000) {
    file_put_contents($dir . '/index.html', $html);
    echo "SUCCESS: Regenerated index.html (" . strlen($html) . " bytes)\n";
} else {
    // Fallback to HTTP if needed
    $url = 'http://localhost/updated_inventory_website/warehouse_finals/index.php';
    $httpHtml = @file_get_contents($url);
    if ($httpHtml !== false && strlen($httpHtml) > 5000) {
        file_put_contents($dir . '/index.html', $httpHtml);
        echo "SUCCESS: Regenerated index.html via HTTP (" . strlen($httpHtml) . " bytes)\n";
    } else {
        echo "FAILED: Could not generate index.html\n";
        exit(1);
    }
}
