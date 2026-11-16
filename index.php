<?php
require_once __DIR__ . '/config/db.php';
$sessionUser = currentUser();
$isLoggedIn = !empty($sessionUser);
$ver = time();
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GymWorx Warehouse — Inventory Management System</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600;700&family=Geist:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">
<link rel="stylesheet" href="css/app.css?v=<?= $ver ?>">
<script>
(function() {
  try {
    var mode = localStorage.getItem('gw_theme_mode') || 'auto';
    var theme = mode;
    if (mode === 'auto') {
      var hr = new Date().getHours();
      theme = (hr >= 6 && hr < 18) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('gw-light-mode');
    } else {
      document.documentElement.classList.add('gw-dark-mode');
    }
  } catch (e) {}
})();
</script>
<style>
[hidden] { display: none !important; }

/* Ensure modal dialogs with form wrappers scroll properly */
.modal-dialog-scrollable .modal-content > form,
.modal-dialog-scrollable form.modal-content {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}
.modal-dialog-scrollable .modal-content > form > .modal-body,
.modal-dialog-scrollable form.modal-content > .modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
}
</style>
</head>
<body class="gw-dark-body">

<?php include __DIR__ . '/views/auth.html'; ?>

<div id="appShell" <?php echo $isLoggedIn ? '' : 'hidden'; ?>>
  <div class="d-flex flex-column gw-app-shell-wrap overflow-hidden">
    <!-- Mobile Topbar -->
    <header class="d-md-none navbar navbar-dark gw-mobile-topbar px-2 px-sm-3 py-2 flex-shrink-0">
      <div class="container-fluid px-0 d-flex align-items-center flex-nowrap gap-2" style="min-width:0;">
        <button class="navbar-toggler border-0 p-1 px-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarOffcanvas" aria-controls="sidebarOffcanvas" aria-label="Open navigation menu" aria-expanded="false">
          <i class="bi bi-list fs-4 text-white"></i>
        </button>
        <span class="gw-brand-cube" style="width:28px;height:28px;font-size:0.95rem;"><i class="bi bi-box-seam"></i></span>
        <div class="lh-1 me-auto overflow-hidden text-truncate" style="min-width:0;">
          <span class="d-block fw-bold text-white small text-truncate">GymWorx</span>
          <span class="d-block text-white-50 text-truncate" style="font-size:0.7rem;" id="mobilePageTitle">Warehouse</span>
        </div>
        <!-- Mobile Theme Toggle -->
        <button type="button" class="btn gw-theme-toggle-btn gw-theme-toggle-btn-mobile flex-shrink-0" id="mobileThemeToggleBtn" aria-label="Toggle light and dark theme" title="Toggle theme">
          <span class="gw-theme-toggle-icon" id="mobileThemeIcon"></span>
        </button>
        <button class="btn btn-outline-light btn-sm position-relative flex-shrink-0" type="button" onclick="navigateTo('notifications')" aria-label="Notifications">
          <i class="bi bi-bell"></i>
          <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill" id="mobileNotifBadge" hidden>0</span>
        </button>
        <button class="btn btn-outline-light btn-sm d-flex align-items-center gap-1 flex-shrink-0" type="button" id="logoutBtnMobile" aria-label="Log out" title="Log out">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </div>
    </header>

    <div class="d-flex flex-grow-1 overflow-hidden" style="min-width:0;">
      <?php include __DIR__ . '/views/sidebar.html'; ?>

      <div class="d-flex flex-column flex-grow-1 overflow-hidden" style="min-width:0;">
        <!-- Desktop Top Navigation Bar -->
        <header class="d-none d-md-flex align-items-center justify-content-between px-3 px-lg-4 py-2 flex-shrink-0 gap-3" id="appTopbar">
          <div class="d-flex align-items-center gap-2 flex-shrink-0">
            <button type="button" class="btn btn-sm gw-sidebar-toggle-btn flex-shrink-0" id="sidebarCollapseBtn" title="Toggle Sidebar" aria-label="Toggle Sidebar">
              <i class="bi bi-list fs-4"></i>
            </button>
            <span class="visually-hidden" id="desktopPageTitle">Dashboard</span>
          </div>

          <div class="d-flex align-items-center gap-2 gap-lg-3 flex-shrink-0">
            <!-- Theme Toggle Button (Immediately to the left of the notification bell) -->
            <button type="button" class="btn gw-theme-toggle-btn flex-shrink-0" id="topbarThemeToggleBtn" aria-label="Toggle light and dark theme" title="Toggle theme">
              <span class="gw-theme-toggle-icon" id="topbarThemeIcon"></span>
            </button>

            <!-- Notification Bell Dropdown -->
            <div class="dropdown">
              <button class="btn btn-light btn-sm position-relative border-0 rounded-circle d-inline-flex align-items-center justify-content-center" style="width:38px;height:38px;" type="button" id="topbarNotifBtn" data-bs-toggle="dropdown" aria-expanded="false" title="Notifications" aria-label="Notifications">
                <i class="bi bi-bell-fill text-dark fs-5"></i>
                <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill" id="topbarNotifBadge" hidden>0</span>
              </button>
              <div class="dropdown-menu dropdown-menu-end shadow border-0 p-0 notif-dropdown-menu" aria-labelledby="topbarNotifBtn">
                <div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-light">
                  <strong class="small text-uppercase text-muted">Notifications</strong>
                  <div class="d-flex gap-2">
                    <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none text-violet fw-semibold" onclick="markAllNotificationsRead()">Mark all read</button>
                    <span class="text-muted">&bull;</span>
                    <button type="button" class="btn btn-link btn-sm p-0 text-decoration-none text-violet fw-semibold" onclick="navigateTo('notifications')">View all</button>
                  </div>
                </div>
                <div id="topbarNotifDropdownList">
                  <div class="p-3 text-center text-muted small fst-italic">No notifications yet.</div>
                </div>
              </div>
            </div>

            <!-- Account Profile Menu -->
            <div class="dropdown">
              <button class="btn btn-light btn-sm border-0 d-flex align-items-center gap-2 px-2 py-1 rounded-pill" type="button" id="topbarAccountMenu" data-bs-toggle="dropdown" aria-expanded="false" aria-label="User account menu">
                <span class="gw-avatar-circle" aria-hidden="true">
                  <i class="bi bi-person-fill"></i>
                </span>
                <div class="text-start lh-sm d-none d-lg-block">
                  <span class="d-block small fw-bold text-dark" id="topbarUserName"><?php echo !empty($sessionUser) ? htmlspecialchars($sessionUser['first_name'] . ' ' . $sessionUser['last_name']) : 'User'; ?></span>
                  <span class="d-block text-muted" style="font-size:0.72rem;" id="topbarUserRoleText"><?php echo !empty($sessionUser['role_name']) ? htmlspecialchars($sessionUser['role_name']) : 'Role'; ?></span>
                </div>
                <span class="badge border d-lg-none" style="font-size:0.68rem;" id="topbarUserRole"><?php echo !empty($sessionUser['role_name']) ? htmlspecialchars($sessionUser['role_name']) : 'Role'; ?></span>
                <i class="bi bi-chevron-down small text-muted ms-1"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end shadow-sm" aria-labelledby="topbarAccountMenu">
                <li><button class="dropdown-item small" type="button" onclick="navigateTo('dashboard')"><i class="bi bi-grid-1x2 me-2 text-violet"></i>My Dashboard</button></li>
                <li><button class="dropdown-item small" type="button" onclick="navigateTo('notifications')"><i class="bi bi-bell me-2 text-violet"></i>Notifications</button></li>
                <li><hr class="dropdown-divider"></li>
                <li class="dropdown-header small text-uppercase text-muted px-3 pt-2 pb-1" style="font-size:0.68rem;letter-spacing:0.04em;">Theme Preference</li>
                <li><button class="dropdown-item small d-flex align-items-center justify-content-between" type="button" onclick="setThemeMode('auto')"><span><i class="bi bi-clock-history me-2"></i>Automatic (Time-based)</span><i class="bi bi-check2 text-success gw-theme-check" data-mode-check="auto"></i></button></li>
                <li><button class="dropdown-item small d-flex align-items-center justify-content-between" type="button" onclick="setThemeMode('light')"><span><i class="bi bi-sun me-2"></i>Light Mode</span><i class="bi bi-check2 text-success gw-theme-check" data-mode-check="light" style="display:none;"></i></button></li>
                <li><button class="dropdown-item small d-flex align-items-center justify-content-between" type="button" onclick="setThemeMode('dark')"><span><i class="bi bi-moon me-2"></i>Dark Mode</span><i class="bi bi-check2 text-success gw-theme-check" data-mode-check="dark" style="display:none;"></i></button></li>
                <li><hr class="dropdown-divider"></li>
                <li><button class="dropdown-item small text-danger" type="button" id="logoutBtnTopbar"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
              </ul>
            </div>
          </div>
        </header>

        <main class="flex-grow-1 p-3 p-md-4 gw-main-content overflow-y-auto overflow-x-hidden" id="mainContent" style="min-width:0;">
          <?php include __DIR__ . '/views/dashboard.html'; ?>
          <?php include __DIR__ . '/views/notifications.html'; ?>

          <?php include __DIR__ . '/views/purchase_request.html'; ?>
          <?php include __DIR__ . '/views/purchase_order.html'; ?>
          <?php include __DIR__ . '/views/stock_receiving.html'; ?>
          <?php include __DIR__ . '/views/stock_releasing.html'; ?>
          <?php include __DIR__ . '/views/purchase_return.html'; ?>
          <?php include __DIR__ . '/views/stocks_return.html'; ?>
          <?php include __DIR__ . '/views/adjustment.html'; ?>
          <?php include __DIR__ . '/views/audit_log.html'; ?>

          <?php include __DIR__ . '/views/category.html'; ?>
          <?php include __DIR__ . '/views/product.html'; ?>
          <?php include __DIR__ . '/views/supplier.html'; ?>
          <?php include __DIR__ . '/views/product_supplier.html'; ?>
          <?php include __DIR__ . '/views/role.html'; ?>
          <?php include __DIR__ . '/views/users.html'; ?>
          <?php include __DIR__ . '/views/inventory_report.html'; ?>

          <footer class="text-center text-muted small pt-4 pb-2">
            &copy; <?= date('Y') ?> GymWorx Warehouse. All rights reserved.
          </footer>
        </main>
      </div>
    </div>
  </div>
</div>

<?php include __DIR__ . '/views/common_templates.html'; ?>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/axios/1.6.7/axios.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>

<script src="js/table_tools.js?v=<?= $ver ?>"></script>
<script src="js/theme.js?v=<?= $ver ?>"></script>
<script src="js/print_receipt.js?v=<?= $ver ?>"></script>
<script src="js/app.js?v=<?= $ver ?>"></script>
<script src="js/login_animation.js?v=<?= $ver ?>"></script>
<script src="js/notifications_audit.js?v=<?= $ver ?>"></script>
<script src="js/dashboard.js?v=<?= $ver ?>"></script>
<script src="js/purchase_request.js?v=<?= $ver ?>"></script>
<script src="js/category.js?v=<?= $ver ?>"></script>
<script src="js/product.js?v=<?= $ver ?>"></script>
<script src="js/supplier.js?v=<?= $ver ?>"></script>
<script src="js/product_supplier.js?v=<?= $ver ?>"></script>
<script src="js/role.js?v=<?= $ver ?>"></script>
<script src="js/users.js?v=<?= $ver ?>"></script>
<script src="js/purchase_order.js?v=<?= $ver ?>"></script>
<script src="js/stock_receiving.js?v=<?= $ver ?>"></script>
<script src="js/stock_releasing.js?v=<?= $ver ?>"></script>
<script src="js/purchase_return.js?v=<?= $ver ?>"></script>
<script src="js/stocks_return.js?v=<?= $ver ?>"></script>
<script src="js/adjustment.js?v=<?= $ver ?>"></script>
<script src="js/inventory_report.js?v=<?= $ver ?>"></script>
</body>
</html>
