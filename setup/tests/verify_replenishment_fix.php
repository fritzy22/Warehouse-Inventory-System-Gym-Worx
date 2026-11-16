<?php
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/permissions.php';
require_once __DIR__ . '/../../config/inventory.php';

$conn = getConnection();

echo "=================================================================\n";
echo " VERIFY REPLENISHMENT CONSISTENCY FIX\n";
echo "=================================================================\n\n";

$passCount = 0;
$failCount = 0;

function check(bool $cond, string $msg, string $details = '') {
    global $passCount, $failCount;
    if ($cond) {
        $passCount++;
        echo "  [PASS] {$msg}" . ($details ? " -> {$details}" : "") . "\n";
    } else {
        $failCount++;
        echo "  [FAIL] {$msg}" . ($details ? " -> {$details}" : "") . "\n";
    }
}

// 1. Authoritative replenishment function
$candidates = getReplenishmentCandidates($conn);
check(count($candidates) === 2, "getReplenishmentCandidates returns exactly 2 items for current DB", "Count: " . count($candidates));

$prodNames = array_map(function($c) { return $c['product_name']; }, $candidates);
check(in_array('Cable Crossover Machine', $prodNames, true), "Cable Crossover Machine is present in candidates");
check(in_array('Olympic Weight Plates Set 100kg', $prodNames, true), "Olympic Weight Plates Set 100kg is present in candidates");

// 2. Check each candidate metrics
foreach ($candidates as $c) {
    if ($c['product_name'] === 'Cable Crossover Machine') {
        check((int)$c['available_stock'] === 0, "Cable Crossover Machine Available Stock is 0", "Avail: " . $c['available_stock']);
        check((int)$c['reorder_level'] === 10, "Cable Crossover Machine Reorder Level is 10", "Reorder: " . $c['reorder_level']);
        check((int)$c['suggested_order_qty'] === 15, "Cable Crossover Machine Suggested Qty is 15", "Suggested: " . $c['suggested_order_qty']);
        check($c['stock_status'] === 'Out of Stock', "Cable Crossover Machine Status is Out of Stock", "Status: " . $c['stock_status']);
    }
    if ($c['product_name'] === 'Olympic Weight Plates Set 100kg') {
        check((int)$c['available_stock'] === 0, "Olympic Weight Plates Set 100kg Available Stock is 0", "Avail: " . $c['available_stock']);
        check((int)$c['reorder_level'] === 10, "Olympic Weight Plates Set 100kg Reorder Level is 10", "Reorder: " . $c['reorder_level']);
        check((int)$c['suggested_order_qty'] === 50, "Olympic Weight Plates Set 100kg Suggested Qty is 50", "Suggested: " . $c['suggested_order_qty']);
        check($c['stock_status'] === 'Out of Stock', "Olympic Weight Plates Set 100kg Status is Out of Stock", "Status: " . $c['stock_status']);
    }
}

// 3. Verify well-stocked products are NOT in candidates
$allProducts = allProductsWithMetrics($conn, true);
$wellStocked = array_filter($allProducts, function($p) {
    return (int)$p['available_stock'] > (int)$p['reorder_threshold'];
});
foreach ($wellStocked as $ws) {
    check(!in_array($ws['product_name'], $prodNames, true), "Well-stocked product '{$ws['product_name']}' is excluded from replenishment", "Avail: {$ws['available_stock']}, Reorder: {$ws['reorder_threshold']}");
}

// 4. Verify Administrator profile dashboard data includes items_to_reorder
$uStmt = $conn->query("SELECT u.*, r.role_name FROM users u LEFT JOIN role r ON r.role_id = u.role_id WHERE u.user_id = 1");
$adminUser = $uStmt->fetch();

$products = allProductsWithMetrics($conn, true);
$lowList = array();
$criticalCount = 0;
$lowCount = 0;
$sufficientList = array();
foreach ($products as $p) {
    if (!empty($p['is_critical_stock'])) {
        $criticalCount++;
        $lowList[] = $p;
    } elseif (!empty($p['is_low_stock'])) {
        $lowCount++;
        $lowList[] = $p;
    } else {
        $sufficientList[] = $p;
    }
}
usort($lowList, function ($a, $b) {
    return (int)$a['available_stock'] - (int)$b['available_stock'];
});

check(count($lowList) === 2, "lowList contains exactly 2 items", "Count: " . count($lowList));
check($criticalCount === 2, "criticalCount (Out of Stock) is 2", "Count: {$criticalCount}");
check($lowCount === 0, "lowCount (Low Stock) is 0", "Count: {$lowCount}");

// 5. Test simulated low stock scenario:
// If a product has 5 in stock and reorder level 10, does it qualify?
$mockRow = array(
    'product_id' => 999,
    'product_name' => 'Mock Low Product',
    'reorder_level' => 10,
    'max_stock' => 50,
    'available_stock' => 5,
    'usable_on_hand_stock' => 5,
    'reserved_stock' => 0,
    'quarantined_stock' => 0,
    'outstanding_pr_qty' => 0,
    'outstanding_po_qty' => 0,
    'open_unapproved_requests' => 0,
    'store_stock' => 0,
    'is_active' => 1,
    'supplier_id' => 1,
    'supplier_name' => 'Supplier A',
    'unit_price' => 10.00
);
$enriched = enrichProductMetricsRow($mockRow);
check($enriched['stock_status'] === 'Low Stock', "Mock item with 5 stock and reorder 10 has status 'Low Stock'");
check($enriched['is_low_stock'] === true, "Mock item has is_low_stock = true");
check($enriched['needs_replenishment'] === true, "Mock item has needs_replenishment = true");

// 6. Test mock out-of-stock scenario:
$mockOos = $mockRow;
$mockOos['available_stock'] = 0;
$mockOos['usable_on_hand_stock'] = 0;
$enrichedOos = enrichProductMetricsRow($mockOos);
check($enrichedOos['stock_status'] === 'Out of Stock', "Mock item with 0 stock has status 'Out of Stock'");
check($enrichedOos['is_critical_stock'] === true, "Mock item has is_critical_stock = true");
check($enrichedOos['needs_replenishment'] === true, "Mock item has needs_replenishment = true");

// 7. Test mock well-stocked scenario:
$mockGood = $mockRow;
$mockGood['available_stock'] = 40;
$mockGood['usable_on_hand_stock'] = 40;
$enrichedGood = enrichProductMetricsRow($mockGood);
check($enrichedGood['stock_status'] === 'In Stock', "Mock item with 40 stock has status 'In Stock'");
check($enrichedGood['is_low_stock'] === false, "Mock well-stocked item has is_low_stock = false");
check($enrichedGood['is_critical_stock'] === false, "Mock well-stocked item has is_critical_stock = false");
check($enrichedGood['needs_replenishment'] === false, "Mock well-stocked item has needs_replenishment = false");

echo "\n=================================================================\n";
echo " RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "=================================================================\n";
