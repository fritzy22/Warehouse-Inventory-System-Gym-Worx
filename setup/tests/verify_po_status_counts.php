<?php
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/inventory.php';

$db = getConnection();

// 1. Authoritative DB counts
$stmt = $db->query("SELECT status, COUNT(*) as cnt FROM purchase_order GROUP BY status");
$dbCounts = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
$totalInDb = (int)$db->query("SELECT COUNT(*) FROM purchase_order")->fetchColumn();

echo "Database PO Statuses:\n";
print_r($dbCounts);
echo "Total in DB: $totalInDb\n";

// 2. Fetch full purchase orders as done in getAllPurchaseOrders
$sql = "SELECT po.po_id, po.status, po.order_date FROM purchase_order po ORDER BY po.po_id DESC";
$allPos = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);

echo "Fetched count: " . count($allPos) . "\n";

$pending = 0;
$approved = 0;
$partial = 0;
$completed = 0;
$cancelled = 0;
$other = 0;

foreach ($allPos as $po) {
    $s = (string)($po['status'] ?? '');
    $sLower = strtolower($s);
    if (strpos($sLower, 'pending') !== false || $sLower === 'draft') {
        $pending++;
    } elseif ($sLower === 'ordered' || $sLower === 'issued') {
        $approved++;
    } elseif ($sLower === 'partially received') {
        $partial++;
    } elseif ($sLower === 'received' || $sLower === 'fully received' || $sLower === 'completed') {
        $completed++;
    } elseif ($sLower === 'cancelled') {
        $cancelled++;
    } else {
        $other++;
    }
}

$totalBreakdown = $pending + $approved + $partial + $completed + $cancelled + $other;

echo "Breakdown:\n";
echo "  Pending: $pending\n";
echo "  Approved: $approved\n";
echo "  Partially Received: $partial\n";
echo "  Completed: $completed\n";
echo "  Cancelled: $cancelled\n";
echo "  Other: $other\n";
echo "  Sum of breakdown: $totalBreakdown\n";

if ($totalBreakdown === $totalInDb) {
    echo "SUCCESS: Sum of breakdown ($totalBreakdown) equals total in DB ($totalInDb)!\n";
} else {
    echo "ERROR: Breakdown mismatch!\n";
}
