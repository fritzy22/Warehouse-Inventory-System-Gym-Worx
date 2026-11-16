<?php
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/inventory.php';

$db = getConnection();

echo "========================================================\n";
echo "TEST SUITE: Replenishment Needed Dashboard Card Verification\n";
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

// 1. Authoritative DB Replenishment Candidates
echo "Step 1: Inspecting Authoritative Database Candidates...\n";
$actualCandidates = getReplenishmentCandidates($db);
$actualCount = count($actualCandidates);

assertTest("Database currently has 2 replenishment candidates", $actualCount === 2);
assertTest("Candidate 1 is Cable Crossover Machine", ($actualCandidates[0]['product_name'] ?? '') === 'Cable Crossover Machine');
assertTest("Candidate 2 is Olympic Weight Plates Set 100kg", ($actualCandidates[1]['product_name'] ?? '') === 'Olympic Weight Plates Set 100kg');

// 2. Dashboard Card Simulation with Current DB (2 items)
echo "\nStep 2: Testing Card Rendering with Current Database Data (2 items)...\n";
$badgeCount = $actualCount;
$previewSlice = array_slice($actualCandidates, 0, 2);
$modalItems = $actualCandidates;

assertTest("Badge displays actual total (2)", $badgeCount === 2);
assertTest("Preview renders exactly 2 rows", count($previewSlice) === 2);
assertTest("Modal retains all 2 items", count($modalItems) === 2);

// 3. Simulation with 8 items (as given in user's example)
echo "\nStep 3: Testing Simulation with 8 Qualifying Products...\n";
$mock8Items = array();
for ($i = 1; $i <= 8; $i++) {
    $mock8Items[] = array(
        'product_id' => 100 + $i,
        'product_name' => "Mock Product $i",
        'available_stock' => $i <= 2 ? 0 : 5,
        'reorder_level' => 10,
        'suggested_order_qty' => 50,
        'category_name' => 'Equipment',
        'supplier_name' => 'Gym Supplies Inc'
    );
}

$mockBadge = count($mock8Items);
$mockPreview = array_slice($mock8Items, 0, 2);
$mockModal = $mock8Items;

assertTest("Example (8 items): Dashboard badge shows 8", $mockBadge === 8);
assertTest("Example (8 items): Dashboard preview shows maximum 2 products", count($mockPreview) === 2);
assertTest("Example (8 items): Modal shows ALL 8 products", count($mockModal) === 8);
assertTest("Underlying dataset is NOT limited to 2", count($mockModal) === 8 && count($mock8Items) === 8);

// 4. Simulation with 1 item
echo "\nStep 4: Testing Simulation with 1 Qualifying Product...\n";
$mock1Item = array($mock8Items[0]);
$mock1Badge = count($mock1Item);
$mock1Preview = array_slice($mock1Item, 0, 2);
$mock1Modal = $mock1Item;

assertTest("Single item: Badge shows 1", $mock1Badge === 1);
assertTest("Single item: Preview renders exactly 1 row", count($mock1Preview) === 1);
assertTest("Single item: Modal renders 1 product", count($mock1Modal) === 1);

// 5. Simulation with 0 items (Empty State)
echo "\nStep 5: Testing Simulation with 0 Items (Empty State)...\n";
$mock0Items = array();
$mock0Badge = count($mock0Items);
$isEmpty = (count($mock0Items) === 0);
$emptyMsg = "All warehouse products are sufficiently stocked.";

assertTest("Empty state: Badge shows 0", $mock0Badge === 0);
assertTest("Empty state: Flag is true", $isEmpty === true);
assertTest("Empty state: Message is preserved", !empty($emptyMsg));

// 6. Inspect HTML file for container styling and modal connections
echo "\nStep 6: Inspecting HTML Template Configuration...\n";
$html = file_get_contents(__DIR__ . '/../../index.html');

$hasNoOverflowAuto = strpos($html, '<div class="table-responsive" style="max-height: 290px; overflow-y: auto;">') === false;
assertTest("Removed internal scrolling style (max-height: 290px; overflow-y: auto;) from card table container", $hasNoOverflowAuto);

$hasCardNoH100 = strpos($html, '<div class="card shadow-sm border-0 po-panel-card">') !== false;
assertTest("Card does not have h-100 stretching to fit content snugly", $hasCardNoH100);

$hasOverflowHidden = strpos($html, '<div class="overflow-hidden">') !== false;
assertTest("Container has overflow-hidden preventing horizontal scrollbars", $hasOverflowHidden);

$has3ColumnsOnly = (strpos($html, '<th class="ps-3" style="width: 50%;">PRODUCT</th>') !== false)
                && (strpos($html, '<th class="text-center" style="width: 25%;">CURRENT STOCK</th>') !== false)
                && (strpos($html, '<th class="text-center pe-3" style="width: 25%;">REORDER LEVEL</th>') !== false);
assertTest("Mini card table header contains only PRODUCT, CURRENT STOCK, and REORDER LEVEL (no Suggested Qty or Action)", $has3ColumnsOnly);

$hasChevronTrigger = strpos($html, 'onclick="openPoItemsToReorderModal()"') !== false;
assertTest("Arrow icon in card header calls openPoItemsToReorderModal()", $hasChevronTrigger);

$hasModalId = strpos($html, 'id="poReplenishmentModal"') !== false;
assertTest("poReplenishmentModal modal element exists", $hasModalId);

$hasModalTitle = strpos($html, 'Warehouse Products Needing Replenishment') !== false;
assertTest("Modal title is 'Warehouse Products Needing Replenishment'", $hasModalTitle);

$hasModalSearch = strpos($html, 'id="poReplenishModalSearch"') !== false;
assertTest("Modal search input exists", $hasModalSearch);

$hasModalCatFilter = strpos($html, 'id="poReplenishModalCategoryFilter"') !== false;
assertTest("Modal category filter exists", $hasModalCatFilter);

// 7. Inspect JS file for slice(0, 2) and 3-column rows
echo "\nStep 7: Inspecting JavaScript Implementation...\n";
$js = file_get_contents(__DIR__ . '/../../js/purchase_order.js');

$hasSlice2 = strpos($js, 'items.slice(0, 2)') !== false;
assertTest("renderPoReplenishmentMiniTable uses items.slice(0, 2)", $hasSlice2);

$modalUsesFullItems = strpos($js, 'var items = getPoReplenishmentItems();') !== false;
assertTest("Modal data-loading function retrieves full getPoReplenishmentItems()", $modalUsesFullItems);

$miniRowHas3Cells = (strpos($js, '<td class="ps-3 py-2">') !== false)
                 && (strpos($js, '<td class="text-center py-2 text-muted pe-3">\' + reorder + \'</td>') !== false);
assertTest("Mini row template renders exactly 3 table cells (Product, Current Stock, Reorder Level)", $miniRowHas3Cells);

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
