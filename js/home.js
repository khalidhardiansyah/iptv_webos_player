// Home Screen Controller
class HomeScreen {
  constructor() {
    this.supabaseClient = new SupabaseClient();
    this.portals = [];
    this.selectedPortal = null;
    this.navigation = new Navigation(); // Initialize Navigation
    this.init();
  }

  async init() {
    console.log('Initializing Home Screen...');
    await this.loadPortals();
    this.setupNavigation();
    this.setupRefreshButton();
  }

  setupRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshPortals());
    }
  }

  async refreshPortals() {
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Add spinning animation
    if (refreshBtn) {
      refreshBtn.classList.add('refreshing');
      refreshBtn.disabled = true;
    }

    console.log('Refreshing portals...');
    await this.loadPortals();

    // Remove spinning animation after a short delay
    setTimeout(() => {
      if (refreshBtn) {
        refreshBtn.classList.remove('refreshing');
        refreshBtn.disabled = false;
      }
    }, 500);
  }

  async loadPortals() {
    const loadingEl = document.getElementById('portals-loading');
    const emptyEl = document.getElementById('portals-empty');
    const errorEl = document.getElementById('portals-error');
    const gridEl = document.getElementById('portals-grid');

    // Show loading
    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    gridEl.classList.add('hidden');

    try {
      this.portals = await this.supabaseClient.getPortals();

      // Hide loading
      loadingEl.classList.add('hidden');

      if (this.portals.length === 0) {
        // Show empty state
        emptyEl.classList.remove('hidden');
      } else {
        // Show portals grid
        gridEl.classList.remove('hidden');
        this.renderPortals();
      }
    } catch (error) {
      console.error('Failed to load portals:', error);
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      document.getElementById('error-message-text').textContent = error.message || 'Failed to connect to database';
    }
  }

  renderPortals() {
    const gridEl = document.getElementById('portals-grid');
    gridEl.innerHTML = '';

    this.portals.forEach((portal, index) => {
      const card = this.createPortalCard(portal, index);
      gridEl.appendChild(card);
    });
    
    // Update navigation focus
    setTimeout(() => {
        this.navigation.updateFocusableElements();
        // Focus first portal if available
        if (this.portals.length > 0) {
            const firstCard = document.querySelector('.portal-card');
            if (firstCard) firstCard.focus();
        }
    }, 100);
  }

  createPortalCard(portal, index) {
    const card = document.createElement('div');
    card.className = 'portal-card';
    card.setAttribute('data-focusable', 'true');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-portal-id', portal.id);
    card.setAttribute('data-portal-index', index);

    // Determine portal type badge
    const typeBadge = `<span class="portal-type-badge ${portal.type}">${portal.type.toUpperCase()}</span>`;
    
    // Status badge
    const statusBadge = `<span class="portal-status-badge"><span class="status-dot"></span> Ready</span>`;

    // Portal icon SVG
    const iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
    `;

    // Build details based on portal type
    let detailsHTML = '';
    
    if (portal.type === 'stalker') {
      detailsHTML = `
        <div class="portal-detail-row">
          <span class="portal-detail-label">URL:</span>
          <span class="portal-detail-value">${this.truncateUrl(portal.url)}</span>
        </div>
        <div class="portal-detail-row">
          <span class="portal-detail-label">MAC:</span>
          <span class="portal-detail-value">${portal.mac}</span>
        </div>
      `;
    } else if (portal.type === 'xtream') {
      detailsHTML = `
        <div class="portal-detail-row">
          <span class="portal-detail-label">Server:</span>
          <span class="portal-detail-value">${this.truncateUrl(portal.server)}</span>
        </div>
        <div class="portal-detail-row">
          <span class="portal-detail-label">Username:</span>
          <span class="portal-detail-value">${portal.username}</span>
        </div>
      `;
    } else if (portal.type === 'm3u') {
      detailsHTML = `
        <div class="portal-detail-row">
          <span class="portal-detail-label">Playlist:</span>
          <span class="portal-detail-value">${this.truncateUrl(portal.playlist_url)}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="portal-card-header">
        <div class="portal-icon">
          ${iconSvg}
        </div>
        <div class="portal-info">
          <h3 class="portal-name">${portal.name}</h3>
          <div class="portal-badges">
            ${typeBadge}
            ${statusBadge}
          </div>
        </div>
      </div>
      <div class="portal-details">
        ${detailsHTML}
      </div>
      <div class="portal-action">
        <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        Click to connect
      </div>
    `;

    // Add click handler
    card.addEventListener('click', () => this.selectPortal(portal));

    return card;
  }

  truncateUrl(url) {
    if (!url) return 'N/A';
    if (url.length <= 30) return url;
    return url.substring(0, 27) + '...';
  }

  async selectPortal(portal) {
    console.log('Selected portal:', portal);
    this.selectedPortal = portal;

    // Update last_used timestamp
    await this.supabaseClient.updateLastUsed(portal.id);

    // Store portal config in sessionStorage for the main app
    sessionStorage.setItem('selectedPortal', JSON.stringify(portal));

    // Navigate to main app
    window.location.href = 'index.html';
  }

  setupNavigation() {
    // Handle back button and refresh shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 461) {
        e.preventDefault();
        this.handleBack();
      } else if (e.key === 'F5' || (e.key === 'r' && !e.ctrlKey) || e.keyCode === 405) {
        // F5, R key, or Yellow button (keyCode 405)
        e.preventDefault();
        this.refreshPortals();
      }
    });

    // WebOS back button
    if (window.webOS) {
      document.addEventListener('webOSRelaunch', () => {
        this.handleBack();
      });
    }
  }

  handleBack() {
    // Exit app
    if (window.webOS && window.webOS.platformBack) {
      window.webOS.platformBack();
    }
  }
}

// Initialize home screen when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.homeScreen = new HomeScreen();
});
