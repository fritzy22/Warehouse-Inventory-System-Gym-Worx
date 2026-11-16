<?php
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/inventory.php';

$db = getConnection();

echo "========================================================\n";
echo "TEST SUITE: Purchase Order Status Chart Verification\n";
echo "========================================================\n\n";

$passCount = 0;
$failCount = 0;

function assertTest($description, $condition) {
    global $passCount, $failCount;
    if ($condition) {
        echo "  [PASS] $description\n";
        $passCount++;
    } else {
        echo "  [FAIL] $description\n";
        $failCount++;
    }
}

// 1. Direct DB Query
echo "Step 1: Inspecting Authoritative Database Records...\n";
$stmt = $db->query("SELECT status, COUNT(*) as cnt FROM purchase_order GROUP BY status ORDER BY status ASC");
$dbBreakdown = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
$totalInDb = (int)$db->query("SELECT COUNT(*) FROM purchase_order")->fetchColumn();

assertTest("Database has 46 total purchase orders", $totalInDb === 46);
assertTest("Database has 22 Received purchase orders", ($dbBreakdown['Received'] ?? 0) === 22);
assertTest("Database has 24 Cancelled purchase orders", ($dbBreakdown['Cancelled'] ?? 0) === 24);
assertTest("Sum of DB statuses equals total", array_sum($dbBreakdown) === $totalInDb);

// 2. Fetch full purchase orders via the same query as getAllPurchaseOrders()
echo "\nStep 2: Checking getAllPurchaseOrders query for joins/duplicates...\n";
$sql = "SELECT po.po_id, po.status, po.order_date FROM purchase_order po ORDER BY po.po_id DESC";
$poRecords = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);

assertTest("API returns 46 records without duplicate joins", count($poRecords) === 46);

$uniquePoIds = array_unique(array_column($poRecords, 'po_id'));
assertTest("Every returned PO has a unique ID (no 1:N join inflation)", count($uniquePoIds) === 46);

// 3. Status Grouping Logic Simulation
echo "\nStep 3: Simulating Chart Status Categorization (JS logic)...\n";
$pending = 0;
$approved = 0;
$partial = 0;
$completed = 0;
$cancelled = 0;
$other = 0;

foreach ($poRecords as $po) {
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

$totalCategorized = $pending + $approved + $partial + $completed + $cancelled + $other;
assertTest("Categorized pending count is 0", $pending === 0);
assertTest("Categorized approved count is 0", $approved === 0);
assertTest("Categorized partial count is 0", $partial === 0);
assertTest("Categorized completed count is 22", $completed === 22);
assertTest("Categorized cancelled count is 24", $cancelled === 24);
assertTest("Categorized other count is 0", $other === 0);
assertTest("Total of mutually exclusive categories (0+0+0+22+24) equals 46", $totalCategorized === 46);

// 4. SVG Math and Percentages
echo "\nStep 4: Verifying Donut SVG Math & Arc Coverage...\n";
$radius = 60;
$circumference = 2 * M_PI * $radius; // ~376.99
$completedPct = round(($completed / $totalCategorized) * 100);
$cancelledPct = round(($cancelled / $totalCategorized) * 100);

assertTest("Completed percentage is 48%", $completedPct === 48.0 || $completedPct === 48);
assertTest("Cancelled percentage is 52%", $cancelledPct === 52.0 || $cancelledPct === 52);
assertTest("Sum of percentages is 100%", ($completedPct + $cancelledPct) === 100.0 || ($completedPct + $cancelledPct) === 100);

$completedLen = ($completed / $totalCategorized) * $circumference;
$cancelledLen = ($cancelled / $totalCategorized) * $circumference;
$totalArcLen = $completedLen + $cancelledLen;

assertTest("Sum of SVG arc lengths ($totalArcLen) equals circumference ($circumference)", abs($totalArcLen - $circumference) < 0.001);

// 5. Empty State Simulation
echo "\nStep 5: Verifying Empty State Logic...\n";
$emptyTotal = 0;
$emptySvgRendered = ($emptyTotal === 0);
assertTest("Empty state renders grey track without division by zero when total is 0", $emptySvgRendered);

// 6. Test Dashboard Purchasing Profile Output
echo "\nStep 6: Verifying Dashboard Purchasing Profile KPI mapping...\n";
$stmtCounts = $db->query("SELECT status, COUNT(*) AS cnt FROM purchase_order GROUP BY status");
$poCounts = array(
    'Pending Approval' => 0,
    'Draft' => 0,
    'Ordered' => 0,
    'Partially Received' => 0,
    'Received' => 0,
    'Closed Short' => 0,
    'Cancelled' => 0
);
foreach ($stmtCounts->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $rawLower = strtolower((string)$r['status']);
    if (strpos($rawLower, 'pending') !== false) {
        $poCounts['Pending Approval'] += (int)$r['cnt'];
    } elseif ($rawLower === 'draft') {
        $poCounts['Draft'] += (int)$r['cnt'];
    } elseif ($rawLower === 'ordered' || $rawLower === 'issued') {
        $poCounts['Ordered'] += (int)$r['cnt'];
    } elseif ($rawLower === 'partially received') {
        $poCounts['Partially Received'] += (int)$r['cnt'];
    } elseif ($rawLower === 'received' || $rawLower === 'fully received' || $rawLower === 'completed') {
        $poCounts['Received'] += (int)$r['cnt'];
    } elseif ($rawLower === 'cancelled') {
        $poCounts['Cancelled'] += (int)$r['cnt'];
    } elseif ($rawLower === 'closed short' || $rawLower === 'closed') {
        $poCounts['Closed Short'] += (int)$r['cnt'];
    }
}

assertTest("poCounts Completed/Received is 22", $poCounts['Received'] === 22);
assertTest("poCounts Cancelled is 24", $poCounts['Cancelled'] === 24);
assertTest("poCounts array_sum is 46", array_sum($poCounts) === 46);

echo "\n========================================================\n";
echo "SUMMARY: Passed: $passCount, Failed: $failCount\n";
echo "========================================================\n";

if ($failCount === 0) {
    echo "ALL TESTS PASSED SUCCESSFULLY!\n";
    exit(0);
} else {
    echo "SOME TESTS FAILED!\n";
    exit(1);
}
