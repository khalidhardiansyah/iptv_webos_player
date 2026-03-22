// Main Application Controller with Sidebar Layout
class App {
  constructor() {
    this.currentScreen = null;
    this.screenHistory = [];
    this.stalkerClient = this.getClient();
    // Alias for generic usage
    this.client = this.stalkerClient;
    this.navigation = new Navigation();
    this.mpegtsPlayer = null;
    this.hlsPlayer = null;
    this.selectedCategory = null;
    this.allGenres = []; // Store all genres for searching
    this.currentChannelList = []; // Store current channel list for navigation
    this.currentChannelIndex = -1; // Current playing channel index
    this.volume = 1.0; // Volume level (0.0 to 1.0)
    this.isMuted = false;
    this.isBuffering = false;
    this.pendingChannelRequest = null; // Track pending channel fetch
    this.pendingSearchRequest = null; // Track pending search
    this.currentContentType = 'live'; // 'live', 'movies', 'series'
    this.isVodContent = false; // Track if current playback is VOD
    this.isOverlayMode = false; // Track if we are in overlay mode
    this.overlayTimer = null; // Timer for auto-hiding overlay

    // Pagination State
    this.vodPagination = {
      items: [],
      currentIndex: 0,
      batchSize: 40,
      isLoading: false
    };

    // Detect WebOS version
    this.webOSVersion = this.detectWebOSVersion();
    console.log('[App] WebOS Version:', this.webOSVersion);

    // FORCE LOCAL PROXY for all versions (WebOS 25 fix)
    this.useStreamProxy = true;
    console.log('[App] Stream proxy FORCED enabled for WebOS 25 compatibility');

    this.init();
  }

  detectWebOSVersion() {
    console.log('[detectWebOSVersion] Starting detection...');
    console.log('[detectWebOSVersion] typeof webOS:', typeof webOS);
    console.log('[detectWebOSVersion] navigator.userAgent:', navigator.userAgent);

    if (typeof webOS === 'undefined' && !navigator.userAgent.includes('Web0S')) {
      console.log('[detectWebOSVersion] Not WebOS, returning 0');
      return 0;
    }

    // Try to get version from User Agent
    const ua = navigator.userAgent;
    // FIXED: Strict matching for Web0S.TV or Web0S to avoid matching "AppleWebKit/537"
    const tvMatch = ua.match(/Web0S\.TV-(\d+)/i) || ua.match(/Web0S;.*Web0STV (\d+)/i);

    console.log('[detectWebOSVersion] tvMatch:', tvMatch);

    if (tvMatch) {
      const version = parseInt(tvMatch[1]);
      console.log('[detectWebOSVersion] Detected version from UA:', version);
      return version;
    }

    // Fallback: If webOS is defined but version not found, check platform
    if (typeof webOS !== 'undefined' && webOS.platform && webOS.platform.tv) {
      console.log('[detectWebOSVersion] webOS defined but no version, returning 5 (legacy)');
      return 5; // Default legacy
    }

    console.log('[detectWebOSVersion] Could not detect version, returning 0');
    return 0; // Not WebOS or unknown
  }

  getClient() {
    const portalData = sessionStorage.getItem('selectedPortal');
    let type = 'stalker';
    if (portalData) {
      try {
        const parsed = JSON.parse(portalData);
        if (parsed.type === 'xtream') type = 'xtream';
      } catch (e) { }
    }

    console.log('[App] Initializing client for type:', type);

    if (type === 'xtream') {
      return new XtreamClient();
    } else {
      return new StalkerClient();
    }
  }

  async init() {
    console.log("Initializing IPTV Stalker App...");
    this.showScreen("loading");
    this.updateLoadingText("Connecting to portal...");

    // Retry handshake up to 2 times for slow servers
    let retries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          this.updateLoadingText(`Retrying connection (${attempt}/${retries})...`);
          console.log(`Handshake attempt ${attempt}/${retries}`);
        }

        // DEBUG LOG TO SCREEN via StalkerClient
        if (this.stalkerClient.logToScreen) {
          this.stalkerClient.logToScreen(`App: Calling handshake attempt ${attempt}`);
        }

        const success = await this.stalkerClient.handshake();
        if (success) {
          this.updateLoadingText("Loading profile...");
          await this.stalkerClient.getProfile();
          this.updateLoadingText("Loading categories...");
          this.showScreen("main");

          // Setup Search Event Listeners
          this.setupCategorySearch();
          this.setupChannelSearch();
          this.setupContentTypeSwitcher();
          this.setupPlayerInteractions();
          this.setupGlobalKeys();
          this.setupClock();



          // Force load initial categories
          setTimeout(async () => { await this.loadCategories(); }, 500);
          return; // Success, exit function
        } else {
          lastError = new Error("Handshake returned false");
        }
      } catch (error) {
        console.error(`Handshake attempt ${attempt} failed:`, error);
        lastError = error;

        // Don't retry if it's not a timeout error
        if (!error.message.includes('timeout')) {
          break;
        }
      }
    }

    console.error("Initialization error after retries:", lastError);
    this.showErrorScreen("Failed to connect: " + (lastError ? lastError.message : "Unknown error"));
  }

  setupGlobalKeys() {
    document.addEventListener('keydown', (e) => {
      // Green Key (404) for Search
      if (e.keyCode === 404 || e.key === 'Green') {
        console.log("Green Key pressed: Focusing Category Search");
        e.preventDefault();
        const searchInput = document.getElementById('category-search');
        if (searchInput) {
          if (this.currentScreen !== 'main') {
            this.showScreen('main');
          }
          searchInput.focus();
        }
      }
    });
  }



  setupCategorySearch() {
    const searchInput = document.getElementById("category-search");
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (this.allGenres.length > 0) {
            const filtered = this.allGenres.filter(g =>
              (g.title && g.title.toLowerCase().includes(query)) ||
              (g.name && g.name.toLowerCase().includes(query))
            );
            this.renderCategories(filtered);
          }
        }, 500);
      });
    }
  }

  setupChannelSearch() {
    const searchInput = document.getElementById("channel-search");
    if (searchInput) {
      let debounceTimer;
      const handleSearch = (query) => {
        if (query.length > 2) {
          this.searchChannels(query);
        } else if (query.length === 0 && this.selectedCategory) {
          this.loadChannels(this.selectedCategory.id, this.selectedCategory.title || this.selectedCategory.name);
        }
      };
      searchInput.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleSearch(e.target.value), 500);
      });
    }
  }

  setupContentTypeSwitcher() {
    const tabs = document.querySelectorAll('.content-type-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const type = tab.dataset.type;
        this.switchContentType(type);
      });
    });
  }

  switchContentType(type) {
    this.currentContentType = type;
    document.querySelectorAll('.content-type-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === type);
    });
    this.selectedCategory = null;
    this.currentChannelList = [];
    this.stopPlayer();

    const channelsTitle = document.getElementById('channels-title');
    if (type === 'live') {
      channelsTitle.textContent = 'Select a category';
      this.loadCategories();
    } else if (type === 'movies' || type === 'series') {
      channelsTitle.textContent = `Select a ${type === 'movies' ? 'movie' : 'series'} category`;
      this.loadVodCategories();
    }
  }

  async loadVodCategories() {
    const container = document.getElementById('categories-container');
    if (!container) return;
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const categories = await this.stalkerClient.getVodCategories();
      if (!categories || categories.length === 0) {
        container.innerHTML = '<div class="empty-state-text">No categories</div>';
        return;
      }
      this.allGenres = categories;
      this.renderCategories(categories);
    } catch (error) {
      container.innerHTML = '<div class="error-message">Failed to load categories</div>';
    }
  }

  setupClock() {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
      const clockEl = document.getElementById('player-clock');
      const dateEl = document.getElementById('player-date');
      if (clockEl) clockEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;
    };
    updateTime();
    setInterval(updateTime, 10000);
  }

  updateLoadingText(text) {
    const loadingText = document.querySelector("#screen-loading .loading-text");
    if (loadingText) loadingText.textContent = text;
  }

  showErrorScreen(message) {
    const loadingScreen = document.getElementById("screen-loading");
    if (loadingScreen) {
      loadingScreen.innerHTML = "<div class=\"loading\"><div class=\"error-message\">" + message + "</div></div>";
    }
  }

  showScreen(screenName) {
    if (screenName === 'player') {
      this.isOverlayMode = false;
      if (this.overlayTimer) clearTimeout(this.overlayTimer);
      document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("overlay-mode");
      });
      // Check if global loading screen is stuck
      const load = document.getElementById("screen-loading");
      if (load) load.classList.remove("active");
    }
    document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
    const screen = document.getElementById("screen-" + screenName);
    if (screen) {
      screen.classList.add("active");
      this.currentScreen = screenName;
      setTimeout(() => this.navigation.updateFocusableElements(), 100);
    }
  }

  toggleOverlayMode() {
    if (this.isOverlayMode) {
      this.closeOverlay();
    } else {
      this.enterOverlayMode();
    }
  }

  enterOverlayMode() {
    this.isOverlayMode = true;
    this.currentScreen = "main";
    const mainScreen = document.getElementById("screen-main");
    const playerScreen = document.getElementById("screen-player");
    mainScreen.classList.add("active");
    mainScreen.classList.add("overlay-mode");
    document.body.setAttribute("data-overlay-active", "true");
    if (playerScreen) playerScreen.classList.add("active");
    this.hidePlayerControls();
    this.navigation.updateFocusableElements();
    setTimeout(() => {
      if (this.currentChannelIndex >= 0) {
        const channels = document.querySelectorAll('.channel-card');
        if (channels[this.currentChannelIndex]) {
          channels[this.currentChannelIndex].focus();
          channels[this.currentChannelIndex].scrollIntoView({ block: "center" });
        }
      }
    }, 100);
    this.startOverlayTimer();
  }

  closeOverlay() {
    document.body.removeAttribute("data-overlay-active");
    this.isOverlayMode = false;
    this.currentScreen = "player";
    if (this.overlayTimer) clearTimeout(this.overlayTimer);
    const mainScreen = document.getElementById("screen-main");
    mainScreen.classList.remove("overlay-mode");
    mainScreen.classList.remove("active");
    this.hidePlayerControls();
    this.navigation.updateFocusableElements();
    window.scrollTo(0, 0);
  }

  startOverlayTimer() {
    if (this.overlayTimer) clearTimeout(this.overlayTimer);
    if (this.isLoading) return;
    const focused = document.activeElement;
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) return;

    this.overlayTimer = setTimeout(() => {
      const currentFocus = document.activeElement;
      const isInputFocused = currentFocus && (currentFocus.tagName === 'INPUT' || currentFocus.tagName === 'TEXTAREA');
      if (this.isOverlayMode && !this.isLoading && !isInputFocused) {
        this.closeOverlay();
      }
    }, 60000);
  }

  resetOverlayTimer() {
    if (this.isOverlayMode) {
      this.startOverlayTimer();
    }
  }

  showExitConfirmation() {
    const exitDialog = document.getElementById("exit-dialog");
    const cancelBtn = document.getElementById("exit-cancel");
    const logoutBtn = document.getElementById("exit-logout");
    const confirmBtn = document.getElementById("exit-confirm");

    exitDialog.classList.remove("hidden");
    this.navigation.updateFocusableElements();
    setTimeout(() => { cancelBtn.focus(); }, 100);

    const handleCancel = () => {
      exitDialog.classList.add("hidden");
      this.navigation.updateFocusableElements();
      cleanup();
    };

    const handleLogout = async () => {
      try { await this.stalkerClient.logout(); } catch (e) { }
      window.location.href = "home.html";
      cleanup();
    };

    const handleConfirm = () => {
      if (window.webOS && window.webOS.platformBack) {
        window.webOS.platformBack();
      }
      cleanup();
    };

    const cleanup = () => {
      cancelBtn.removeEventListener("click", handleCancel);
      if (logoutBtn) logoutBtn.removeEventListener("click", handleLogout);
      confirmBtn.removeEventListener("click", handleConfirm);
    };

    cancelBtn.addEventListener("click", handleCancel);
    if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
    confirmBtn.addEventListener("click", handleConfirm);
  }

  pushScreen(screenName) {
    if (this.currentScreen) {
      this.screenHistory.push(this.currentScreen);
    }
    this.showScreen(screenName);
  }

  popScreen() {
    if (this.screenHistory.length > 0) {
      this.showScreen(this.screenHistory.pop());
    }
  }

  async loadCategories() {
    const container = document.getElementById("categories-container");
    if (!container) return;
    container.innerHTML = '<div class="skeleton-sidebar-list"><div class="skeleton-sidebar-item"></div><div class="skeleton-sidebar-item"></div><div class="skeleton-sidebar-item"></div><div class="skeleton-sidebar-item"></div><div class="skeleton-sidebar-item"></div></div>';

    try {
      const genres = await this.stalkerClient.getGenres();
      if (!genres || genres.length === 0) {
        container.innerHTML = "<div class=\"empty-state-text\">No categories</div>";
        return;
      }
      this.allGenres = genres;
      this.renderCategories(genres);
    } catch (error) {
      console.error("Load categories error:", error);
    }
  }

  renderCategories(genres) {
    const container = document.getElementById("categories-container");
    if (!container) return;
    container.innerHTML = "";
    this.currentCategoryList = genres;

    if (genres.length === 0) {
      container.innerHTML = "<div class=\"empty-state-text\">No matches</div>";
      return;
    }

    const fragment = document.createDocumentFragment();

    genres.forEach((genre, index) => {
      const item = document.createElement("div");
      item.className = "category-item";
      item.setAttribute("data-focusable", "true");
      item.setAttribute("data-category-index", index);
      // Simplified innerHTML
      item.textContent = (genre.title || genre.name) + " (" + (genre.censored || 0) + ")";
      item.addEventListener("click", () => this.selectCategory(genre, item));
      fragment.appendChild(item);
    });

    container.appendChild(fragment);

    // Select first category by default and trigger background caching
    if (genres.length > 0) {
      // Find the actual item element for the first genre to pass to selectCategory
      // This assumes the first genre in the `genres` array corresponds to the first item in the fragment
      const firstItemElement = container.querySelector(`[data-category-index="0"]`);
      // If the element is not yet in the DOM (because fragment is appended later),
      // we can create a dummy element or adjust selectCategory to not require it.
      // For now, let's assume it's okay to pass null or find it after appending.
      // A better approach might be to call selectCategory with just genre data.
      // Let's adjust selectCategory to accept just genre and find the element itself.
      // Or, since we have the fragment, we can get the first child of the fragment.
      const firstGenre = genres[0];
      const firstRenderedItem = fragment.firstChild; // This will be the first category-item

      // We need to ensure the item is in the DOM for `selectCategory` to add 'active' class correctly.
      // So, we'll call selectCategory after the fragment is appended and elements are focusable.
      setTimeout(() => {
        if (firstGenre && firstRenderedItem) {
          this.selectCategory(firstGenre, firstRenderedItem);
        }
        // Trigger background caching for global search
        this.loadAllChannelsToCache();
      }, 300); // Delay to let UI settle and elements be in DOM
    }

    this.navigation.updateFocusableElements();
  }

  selectCategory(genre, itemElement) {
    document.querySelectorAll(".category-item").forEach(item => item.classList.remove("active"));
    if (itemElement) itemElement.classList.add("active");
    this.selectedCategory = genre;

    if (this.currentContentType === 'live') {
      this.loadChannels(genre.id, genre.title || genre.name);
    } else {
      this.loadVodItems(genre.id, genre.title || genre.name);
    }
  }

  async loadVodItems(categoryId, categoryTitle) {
    const container = document.getElementById('channels-container');
    container.classList.add('vod-grid');
    container.innerHTML = '<div class="skeleton-grid"><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div><div class="skeleton-vod-card"></div></div>';
    document.getElementById('channels-title').textContent = categoryTitle;

    try {
      console.log(`Loading VOD items for category ${categoryId}`);
      const response = await this.stalkerClient.getVodItems(categoryId);
      console.log("VOD Response:", response);

      let items = [];
      if (Array.isArray(response)) {
        items = response;
      } else if (response && Array.isArray(response.data)) {
        items = response.data;
      } else if (response && response.js && Array.isArray(response.js.data)) {
        items = response.js.data;
      }

      console.log(`Parsed ${items.length} items`);

      // DEBUG: Log to screen if empty
      if (!items || items.length === 0) {
        console.warn("VOD: No items found after parsing", response);
        container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No items found (Empty Reply)</div></div>';
        return;
      }

      this.currentChannelList = items;
      this.renderVodItems(items);
    } catch (error) {
      console.error("VOD Load Error:", error);
      // Force string conversion for Error objects
      const errorStr = (typeof error === 'object') ? (error.message || JSON.stringify(error)) : String(error);
      const outputMsg = error.errorText || errorStr;

      container.innerHTML = `<div class="error-message">Failed: ${outputMsg}</div>`;
    }
  }

  renderVodItems(items) {
    const container = document.getElementById('channels-container');
    container.innerHTML = '';

    // Use CSS class for Grid Layout
    container.classList.add('vod-grid');
    container.removeAttribute('style'); // Clear inline overrides

    // Initialize Pagination
    this.vodPagination = {
      items: items,
      currentIndex: 0,
      batchSize: 40,
      isLoading: false
    };

    // Initialize Spatial Navigation Section for VOD Grid to prevent focus escaping
    if (typeof SpatialNavigation !== 'undefined') {
      // Safely remove existing section to prevent errors on reload
      SpatialNavigation.remove('vod-grid');

      SpatialNavigation.add('vod-grid', {
        selector: '#channels-container .vod-card',
        restrict: 'self-first',
        enterTo: 'last-focused'
      });
      // Ensure we prioritize this section when active
      SpatialNavigation.makeFocusable('vod-grid');
    }

    // Setup Scroll Listener if not already attached
    this.setupVodScroll();

    // Render First Batch
    this.renderVodBatch();
  }

  renderVodBatch() {
    if (this.vodPagination.isLoading) return;
    this.vodPagination.isLoading = true;

    const { items, currentIndex, batchSize } = this.vodPagination;
    if (currentIndex >= items.length) {
      this.vodPagination.isLoading = false;
      return;
    }

    const container = document.getElementById('channels-container');
    const fragment = document.createDocumentFragment();

    const nextIndex = Math.min(currentIndex + batchSize, items.length);
    const batch = items.slice(currentIndex, nextIndex);

    batch.forEach((item, i) => {
      const globalIndex = currentIndex + i;
      const card = document.createElement('div');
      card.className = 'vod-card';
      card.setAttribute('data-focusable', 'true');
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-vod-index', globalIndex);
      // Added A11y
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', item.name || item.title || 'Unknown Video');

      let poster = item.screenshot_uri || item.cover_big || item.screenshot || item.logo || '';

      // Fix relative URLs for posters
      if (poster && !poster.startsWith('http')) {
        // Some portals use relative paths from root
        if (poster.startsWith('/')) {
          // Extract protocol+host from portalUrl
          try {
            const urlParts = new URL(this.stalkerClient.portalUrl);
            poster = urlParts.origin + poster;
          } catch (e) { }
        } else {
          // Or relative to portal folder
          poster = this.stalkerClient.portalUrl + poster;
        }
      }

      const title = item.name || item.title || 'Untitled';

      card.innerHTML = `
         <img src="${poster}" loading="lazy" decoding="async" alt="${title}" class="vod-poster" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22%3E%3Crect fill=%22%230f172a%22 width=%22100%25%22 height=%22100%25%22/%3E%3C/svg%3E'">
         <div class="vod-overlay"><div class="vod-title">${title}</div></div>
       `;
      card.addEventListener('click', () => this.playVodItem(item, globalIndex));
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    this.vodPagination.currentIndex = nextIndex;
    this.vodPagination.isLoading = false;

    // If this was the first batch, update focusable elements
    if (currentIndex === 0) {
      this.navigation.updateFocusableElements();
    } else {
      // Just append to focus list without full rebuild if possible (but Navigation class replaces all)
      this.navigation.updateFocusableElements();
    }
  }

  setupVodScroll() {
    const container = document.getElementById('channels-container');
    if (container.dataset.scrollAttached) return;

    console.log('[LazyLoad] Setting up VOD scroll listener');

    let isScrolling = false;
    container.addEventListener('scroll', () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          if (!container.classList.contains('vod-grid')) {
            isScrolling = false;
            return;
          }

          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;
          const distanceToBottom = scrollHeight - scrollTop - clientHeight;

          // Load more when user is 300px away from bottom
          if (distanceToBottom <= 300) {
            console.log(`[LazyLoad VOD] Scroll trigger: ${Math.round(distanceToBottom)}px from bottom`);
            this.renderVodBatch();
          }
          isScrolling = false;
        });
        isScrolling = true;
      }
    });
    container.dataset.scrollAttached = "true";
  }

  handleEnter(element) {
    if (!element) return false;
    if (element.classList.contains('channel-card')) {
      const index = parseInt(element.getAttribute('data-channel-index'));
      if (!isNaN(index) && this.currentChannelList && this.currentChannelList[index]) {
        this.playChannel(this.currentChannelList[index], index);
        return true;
      }
    } else if (element.classList.contains('category-item')) {
      const index = parseInt(element.getAttribute('data-category-index'));
      if (!isNaN(index) && this.currentCategoryList && this.currentCategoryList[index]) {
        this.selectCategory(this.currentCategoryList[index], element);
        return true;
      }
    } else if (element.classList.contains('vod-card')) {
      const index = parseInt(element.getAttribute('data-vod-index'));
      if (!isNaN(index) && this.currentChannelList && this.currentChannelList[index]) {
        this.playVodItem(this.currentChannelList[index], index);
        return true;
      }
    } else if (element.classList.contains('content-type-tab')) {
      const type = element.getAttribute('data-type');
      if (type) {
        this.switchContentType(type);
        return true;
      }
    }
    if (element.tagName === 'BUTTON') {
      element.click();
      return true;
    }
    return false;
  }

  async loadChannels(genreId, genreTitle) {
    if (this.pendingChannelRequest) {
      this.pendingChannelRequest.aborted = true;
      this.pendingChannelRequest = null;
    }
    const requestTracker = { aborted: false };
    this.pendingChannelRequest = requestTracker;

    const searchInput = document.getElementById("channel-search");
    if (searchInput) searchInput.value = "";
    document.getElementById("channels-title").textContent = genreTitle;
    const container = document.getElementById("channels-container");

    // Reset Grid Class for Live TV
    container.classList.remove('vod-grid');
    container.removeAttribute('style'); // Clear inline styles from VOD mode

    container.innerHTML = '<div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';

    // Initialize Pagination State
    this.channelPagination = {
      genreId: genreId,
      page: 1,
      isLoading: false,
      hasMore: true
    };

    try {
      const channels = await this.stalkerClient.getChannels(genreId, 1);
      if (requestTracker.aborted) return;

      if (!channels || channels.length === 0) {
        container.innerHTML = "<div class=\"empty-state\"><div class=\"empty-state-title\">No channels</div></div>";
        this.channelPagination.hasMore = false;
        return;
      }

      this.masterChannelList = channels; // Store master list for local search
      this.currentChannelList = channels;
      this.renderChannels(channels);

      // Setup Scroll Listener
      this.setupChannelScroll();

    } catch (error) {
      if (!requestTracker.aborted) {
        container.innerHTML = `<div class="error-message">Failed: ${error.message}</div>`;
      }
    } finally {
      if (this.pendingChannelRequest === requestTracker) this.pendingChannelRequest = null;
    }
  }

  setupChannelScroll() {
    const container = document.getElementById('channels-container');
    if (container.dataset.channelScrollAttached) return;

    console.log('[LazyLoad] Setting up channel scroll listener');

    let isScrolling = false;
    container.addEventListener('scroll', () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          if (container.classList.contains('vod-grid')) {
            isScrolling = false;
            return; // Ignore if in VOD mode
          }

          // Disable infinite scroll if searching (local search result)
          const searchInput = document.getElementById("channel-search");
          if (searchInput && searchInput.value.trim().length > 0) {
            isScrolling = false;
            return;
          }

          const scrollTop = container.scrollTop;
          const scrollHeight = container.scrollHeight;
          const clientHeight = container.clientHeight;
          const distanceToBottom = scrollHeight - scrollTop - clientHeight;

          // Load more when user is 300px away from bottom
          if (distanceToBottom <= 300) {
            console.log(`[LazyLoad] Scroll trigger: ${Math.round(distanceToBottom)}px from bottom`);
            this.loadMoreChannels();
          }
          isScrolling = false;
        });
        isScrolling = true;
      }
    });
    container.dataset.channelScrollAttached = "true";
  }

  async loadMoreChannels() {
    // Debug: Log pagination state
    console.log('[LazyLoad] loadMoreChannels called', {
      hasPagination: !!this.channelPagination,
      isLoading: this.channelPagination ? this.channelPagination.isLoading : false,
      hasMore: this.channelPagination ? this.channelPagination.hasMore : false,
      currentPage: this.channelPagination ? this.channelPagination.page : 0,
      genreId: this.channelPagination ? this.channelPagination.genreId : null
    });

    if (!this.channelPagination) {
      console.warn('[LazyLoad] No pagination state initialized');
      return;
    }
    if (this.channelPagination.isLoading) {
      console.log('[LazyLoad] Already loading, skipping...');
      return;
    }
    if (!this.channelPagination.hasMore) {
      console.log('[LazyLoad] No more channels to load');
      return;
    }

    this.channelPagination.isLoading = true;
    this.channelPagination.page++;
    console.log(`[LazyLoad] ⏳ Loading page ${this.channelPagination.page} for genre: ${this.channelPagination.genreId}`);

    try {
      const newChannels = await this.stalkerClient.getChannels(this.channelPagination.genreId, this.channelPagination.page);

      if (!newChannels || newChannels.length === 0) {
        console.log('[LazyLoad] ✅ End of list reached (no more channels)');
        this.channelPagination.hasMore = false;
        this.channelPagination.isLoading = false;
        return;
      }

      console.log(`[LazyLoad] ✅ Loaded ${newChannels.length} new channels`);

      // Update Master List
      if (!this.masterChannelList) this.masterChannelList = [];
      this.masterChannelList = this.masterChannelList.concat(newChannels);

      // Append to current list
      this.currentChannelList = this.currentChannelList.concat(newChannels);
      this.appendChannels(newChannels);

      console.log(`[LazyLoad] Total channels now: ${this.currentChannelList.length}`);

    } catch (e) {
      console.error('[LazyLoad] ❌ Error loading more channels:', e);
      this.channelPagination.page--; // Revert page on error
    } finally {
      this.channelPagination.isLoading = false;
    }
  }

  appendChannels(channels) {
    const container = document.getElementById("channels-container");
    const fragment = document.createDocumentFragment();
    // Calculate start index based on the *current* list size minus what we just added
    // But currentChannelList is already updated in loadMoreChannels
    const startIndex = this.currentChannelList.length - channels.length;

    channels.forEach((channel, i) => {
      const index = startIndex + i;
      const card = document.createElement("div");
      card.className = "channel-card";
      card.setAttribute("data-focusable", "true");
      card.setAttribute("tabindex", "0");
      card.setAttribute("data-channel-index", index);
      // Added A11y
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${channel.name || 'Unknown channel'}, number ${channel.number || channel.id}`);

      const name = channel.name || 'Unknown';
      const num = channel.number || channel.id;

      card.innerHTML = `<div class="channel-card-info"><div class="channel-card-name">${name}</div><div class="channel-card-number">${num}</div></div>`;

      if (channel.logo) {
        const logoDiv = document.createElement('div');
        logoDiv.className = 'channel-card-logo';
        logoDiv.innerHTML = `<img src="${channel.logo}" loading="lazy" decoding="async" alt="">`;
        card.insertBefore(logoDiv, card.firstChild);
      }

      card.addEventListener("click", () => {
        this.playChannel(channel, index);
      });
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    this.navigation.updateFocusableElements();
  }

  async loadAllChannelsToCache() {
    if (this.fullCacheChannelList && this.fullCacheChannelList.length > 0) return;

    console.log("Caching all channels for global search...");
    // Optional: Add UI indicator that background caching is happening?
    // For now, keep it silent

    try {
      // Use '*' to fetch all channels
      // Note: This might take time and memory
      const allChannels = await this.stalkerClient.getChannels('*');

      if (allChannels && allChannels.length > 0) {
        this.fullCacheChannelList = allChannels;
        console.log(`Global Cache: Loaded ${this.fullCacheChannelList.length} channels.`);
      }
    } catch (error) {
      console.warn("Background caching failed:", error);
    }
  }

  async searchChannels(query) {
    // LOCAL SEARCH IMPLEMENTATION (GLOBAL SCOPE)
    const searchInput = query.toLowerCase().trim();
    const container = document.getElementById("channels-container");

    if (!container) return;

    // Update Title
    const titleEl = document.getElementById("channels-title");
    titleEl.textContent = searchInput === "" ?
      (this.selectedCategory ? (this.selectedCategory.title || this.selectedCategory.name) : "Channels")
      : `Search: "${query}"`;

    // If input empty, revert to CURRENT category list
    if (searchInput === "") {
      if (this.masterChannelList) {
        this.renderChannels(this.masterChannelList);
      }
      return;
    }

    console.log('Global Searching for:', searchInput);

    // Determine which list to search: Global Cache or Local Category Cache
    // If Global Cache exists, use it. Otherwise fall back to local (masterChannelList)
    const sourceList = (this.fullCacheChannelList && this.fullCacheChannelList.length > 0)
      ? this.fullCacheChannelList
      : this.masterChannelList;

    if (!sourceList || sourceList.length === 0) {
      container.innerHTML = "<div class=\"empty-state\"><div class=\"empty-state-title\">No data to search</div></div>";
      return;
    }

    // Filter memory
    const filtered = sourceList.filter(channel => {
      const name = (channel.name || channel.title || "").toLowerCase();
      return name.includes(searchInput);
    });

    // Render results
    this.renderChannels(filtered);

    if (filtered.length === 0) {
      container.innerHTML = `<div class=\"empty-state\"><div class=\"empty-state-title\">No results for "${query}"</div></div>`;
    }
  }

  renderChannels(channels) {
    const container = document.getElementById("channels-container");
    container.innerHTML = "";
    container.classList.remove('vod-grid'); // Ensure VOD grid class is removed
    container.removeAttribute('style');     // clear inline styles
    this.currentChannelList = channels;

    const fragment = document.createDocumentFragment();

    channels.forEach((channel, index) => {
      const card = document.createElement("div");
      card.className = "channel-card";
      card.setAttribute("data-focusable", "true");
      card.setAttribute("tabindex", "0");
      card.setAttribute("data-channel-index", index);
      // Added A11y
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${channel.name || 'Unknown channel'}, number ${channel.number || channel.id}`);

      const name = channel.name || 'Unknown';
      const num = channel.number || channel.id;

      card.innerHTML = `<div class="channel-card-info"><div class="channel-card-name">${name}</div><div class="channel-card-number">${num}</div></div>`;


      if (channel.logo) {
        const logoDiv = document.createElement('div');
        logoDiv.className = 'channel-card-logo';
        logoDiv.innerHTML = `<img src="${channel.logo}" loading="lazy" decoding="async" alt="">`;
        card.insertBefore(logoDiv, card.firstChild);
      }

      card.addEventListener("click", () => {
        // Hide any lingering global loaders
        const screenLoading = document.getElementById("screen-loading");
        if (screenLoading) screenLoading.classList.remove("active");

        this.playChannel(channel, index);
      });
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
    this.navigation.updateFocusableElements();
  }

  async playChannel(channel, channelIndex = -1, force = false) {
    if (!force && this.currentChannel && this.currentChannel.id === channel.id) {
      if (this.isOverlayMode) this.closeOverlay();
      else this.pushScreen("player");
      return;
    }

    // Don't close overlay if it's a retry (force=true) OR if retrying the same channel
    const isRetryingSameChannel = force && this.currentChannel && this.currentChannel.id === channel.id;
    if (!force && !isRetryingSameChannel && this.isOverlayMode) this.closeOverlay();

    // Reset state
    const vodControls = document.getElementById("vod-controls");
    if (vodControls) vodControls.classList.add("hidden");
    const playerHints = document.querySelector(".player-hints");
    if (playerHints) playerHints.style.display = "flex";
    this.isVodContent = false;

    window.scrollTo(0, 0);
    this.currentChannel = channel;
    this.pushScreen("player");

    // Force hide global loading screen to prevent "top-left loading" issue
    const globalLoading = document.getElementById("screen-loading");
    if (globalLoading) globalLoading.classList.remove("active");

    this.currentChannelIndex = channelIndex;
    this.playbackSessionId = (this.playbackSessionId || 0) + 1;

    // Reset retry count only if NOT a retry (force=false means user initiated)
    if (!force) {
      this.retryCount = 0;
    }
    this.maxRetries = 3;

    const video = document.getElementById("video-player");
    const playerLoading = document.getElementById("player-loading");
    const playerLoadingText = document.getElementById("player-loading-text");
    const playerBuffering = document.getElementById("player-buffering");

    // Remove any leftover fatal error element from a previous failed attempt
    const existingErr = document.getElementById("player-fatal-error");
    if (existingErr) existingErr.remove();

    // Clear EPG placeholder
    const epgTitle = document.getElementById("player-epg-title");
    if (epgTitle) epgTitle.textContent = "";

    // Clear previous status
    const statusEl = document.getElementById("player-status");
    if (statusEl) statusEl.textContent = "";

    // Only show loading screen if NOT in overlay mode OR if it's initial load (not retry)
    // This makes retry silent when overlay is active
    if (playerLoading && (!this.isOverlayMode || !force)) {
      playerLoading.style.display = "flex";
      playerLoadingText.textContent = "Connecting...";
    }
    if (playerBuffering) playerBuffering.classList.add("hidden");

    // RESET UI STATE from VOD mode
    const playerScreen = document.getElementById("screen-player");
    playerScreen.classList.remove("vod-mode");

    // Unhide elements potentially hidden by VOD
    const brandEl = document.querySelector(".player-channel-brand");
    if (brandEl) brandEl.style.display = "flex";

    const nameEl = document.querySelector(".player-channel-name");
    if (nameEl) nameEl.style.display = "block";

    const epgEl = document.querySelector(".player-epg-title");
    if (epgEl) epgEl.style.display = "block";

    // Update UI
    document.getElementById("player-channel-name").textContent = channel.name;
    const numEl = document.getElementById("player-channel-number");
    if (numEl) numEl.textContent = (channel.number || channel.id).toString();

    this.showPlayerControls();

    try {
      // 1. Get Stream URL
      playerLoadingText.textContent = "Getting link...";
      const streamUrl = await this.stalkerClient.createLink(channel.id, channel.cmd);

      if (!streamUrl) throw new Error("No URL from portal");
      console.log('[Playback] Stream URL:', streamUrl.substring(0, 100));

      // 2. Decide Proxy Usage (SOLUSI ULTIMATE WEBOS 25)
      let proxiedStreamUrl = streamUrl;

      // Skip proxy for Xtream mode - URLs already include credentials
      const isXtreamMode = !this.stalkerClient.mac; // Xtream doesn't have MAC

      if (this.useStreamProxy && !isXtreamMode) {
        playerLoadingText.textContent = "Proxy setup...";
        console.log('[Playback] Using proxy (Stalker mode)');
        if (this.stalkerClient.useLuna && this.stalkerClient.lunaClient) {
          proxiedStreamUrl = await this.stalkerClient.lunaClient.streamProxy(streamUrl, this.stalkerClient.portalUrl, this.stalkerClient.mac);
        } else {
          const proxyUrl = "https://iptv.khalidhard.live/api/stream";
          proxiedStreamUrl = proxyUrl + "?url=" + encodeURIComponent(streamUrl);
        }
      } else {
        if (isXtreamMode) {
          console.log('[Playback] Skipping proxy (Xtream mode - direct URL)');
        } else {
          console.log('[Playback] Skipping proxy (WebOS >= 25), using direct stream');
        }
      }

      // 3. Cleanup previous players
      if (this.stallInterval) {
        clearInterval(this.stallInterval);
        this.stallInterval = null;
      }
      if (this.mpegtsPlayer) {
        try { this.mpegtsPlayer.destroy(); } catch (e) { }
        this.mpegtsPlayer = null;
      }
      if (this.hlsPlayer) {
        try { this.hlsPlayer.destroy(); } catch (e) { }
        this.hlsPlayer = null;
      }

      // Check for HLS (.m3u8) - Check ORIGINAL URL too because proxy hides extension
      if (proxiedStreamUrl.includes('.m3u8') || proxiedStreamUrl.includes('type=m3u8') || streamUrl.includes('.m3u8') || streamUrl.includes('type=m3u8')) {
        if (Hls.isSupported()) {
          console.log("Playing HLS stream with hls.js");
          this.hlsPlayer = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90
          });

          this.hlsPlayer.loadSource(proxiedStreamUrl);
          this.hlsPlayer.attachMedia(video);

          this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
            video.addEventListener('playing', () => {
              if (playerLoading) playerLoading.style.display = 'none';
              if (playerBuffering) playerBuffering.classList.add('hidden');
              const gLoad = document.getElementById('screen-loading');
              if (gLoad) gLoad.classList.remove('active');
            }, { once: true });
            video.play().catch(e => console.error("HLS play error:", e));
            this.showPlayerControls();
          });

          this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
            console.error("HLS Error:", data);
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log("fatal network error encountered, try to recover");
                  this.hlsPlayer.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log("fatal media error encountered, try to recover");
                  this.hlsPlayer.recoverMediaError();
                  break;
                default:
                  this.hlsPlayer.destroy();
                  this.handlePlayerError("HLS_FATAL", data.type, currentSessionId);
                  break;
              }
            }
          });

          const currentSessionId = this.playbackSessionId;
          video.volume = this.volume || 1.0;
          video.muted = false;
          return; // Exit mpegts setup
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          console.log("Playing HLS stream natively");
          video.addEventListener('playing', () => {
            if (playerLoading) playerLoading.style.display = 'none';
            if (playerBuffering) playerBuffering.classList.add('hidden');
            const gLoad = document.getElementById('screen-loading');
            if (gLoad) gLoad.classList.remove('active');
          }, { once: true });
          video.src = proxiedStreamUrl;
          video.play();
          return;
        }
      }

      // WEBOS 25 FIX: Use Native Player (Requested by User)
      // Native player is required for 8K streams and to avoid EarlyEof loop
      if (this.webOSVersion >= 25) {
        console.log('[Playback] Using native WebOS player for MPEG-TS (WebOS 25+)');

        // Cleanup mpegts if exists
        if (this.mpegtsPlayer) {
          this.mpegtsPlayer.destroy();
          this.mpegtsPlayer = null;
        }
        if (this.stallInterval) clearInterval(this.stallInterval);
        if (this.stuckTimer) clearInterval(this.stuckTimer);

        // Hard Reset Function to avoid Format Error
        const hardReload = () => {
          if (this.playbackSessionId !== currentSessionId) return;
          console.log('[Native Player] Performing Hard Reload...');

          video.pause();
          video.removeAttribute('src'); // Clear source
          video.load(); // Reset media element

          setTimeout(() => {
            if (this.playbackSessionId !== currentSessionId) return;
            console.log('[Native Player] Reloading stream URL...');
            this.playChannel(this.currentChannel, this.currentChannelIndex, true);
          }, 500);
        };

        // Use native HTML5 video player
        video.src = proxiedStreamUrl;
        video.loop = true; // TRICK: Auto-restart on EOS without reloading player
        video.load();

        // Setup event listeners for native player
        video.addEventListener('loadedmetadata', () => {
          console.log('[Native Player] Metadata loaded, duration:', video.duration);
          if (playerLoading) playerLoading.style.display = 'none';
        }, { once: true });

        video.addEventListener('playing', () => {
          console.log('[Native Player] Playback started');
          if (playerLoading) playerLoading.style.display = 'none';
          if (playerBuffering) playerBuffering.classList.add('hidden');

          const gLoad = document.getElementById('screen-loading');
          if (gLoad) gLoad.classList.remove('active');

          this.showPlayerControls();
          video.muted = false;
          video.volume = this.volume || 1.0;
        });

        video.addEventListener('waiting', () => {
          console.log('[Native Player] Event: waiting (buffering)');
          if (playerLoading && getComputedStyle(playerLoading).display !== 'none') return;
          if (playerBuffering) playerBuffering.classList.remove('hidden');
        });

        // CRITICAL FIX: Auto-resume on pause for live streams
        video.addEventListener('pause', () => {
          // Ignore pause if ended (let ended handler work)
          if (video.ended) return;

          console.log('[Native Player] Event: pause - check if auto-resume needed');
          setTimeout(() => {
            if (video.paused && !video.ended && this.playbackSessionId === currentSessionId) {
              console.log('[Native Player] Auto-resuming...');
              video.play().catch(e => console.error('[Native Player] Resume error:', e));
            }
          }, 200);
        });

        // CRITICAL FIX: Handle ended/error with hard reload
        video.addEventListener('ended', () => {
          console.log('[Native Player] Event: ended - checking loop or reloading');
          // With video.loop = true, this might not fire often, but if it does:
          setTimeout(() => {
            if (this.playbackSessionId === currentSessionId) {
              console.log('[Native Player] Stream ended despite loop, triggering reload');
              hardReload();
            }
          }, 1000); // Wait 1s to see if loop kicks in
        });

        video.addEventListener('error', (e) => {
          const err = video.error;
          console.error('[Native Player] Error:', err ? err.code : 'unknown', err ? err.message : '');

          // Code 4 = Format Error (often needs hard reset)
          if (err && err.code === 4) {
            console.warn('[Native Player] Format Error detected, attempting hard reload...');
            hardReload();
            return;
          }
        });

        // Stall Detection for Native Player
        const currentSessionId = this.playbackSessionId;
        let lastCurrentTime = 0;
        let stallCount = 0;
        let lastBufferedEnd = 0;
        const maxStallCount = 30; // Increased from 10 to 30 seconds for 8K/Slow Network

        console.log('[Native Player] Starting stall detector (Threshold: 30s)...');

        this.stallInterval = setInterval(() => {
          if (!video || this.playbackSessionId !== currentSessionId) return;

          // Helper to get buffer end
          const getBufferedEnd = () => {
            try {
              return video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;
            } catch (e) { return 0; }
          };

          const currentBufferedEnd = getBufferedEnd();
          const isBuffering = currentBufferedEnd > lastBufferedEnd;
          lastBufferedEnd = currentBufferedEnd;

          // Log video state periodically or when stalled
          if (stallCount > 0 && stallCount % 5 === 0) {
            console.log(`[Native Player Stall] Count: ${stallCount}/${maxStallCount}`, {
              paused: video.paused,
              readyState: video.readyState,
              currentTime: video.currentTime,
              networkState: video.networkState, // 2 = Loading
              bufferedEnd: currentBufferedEnd,
              isBuffering: isBuffering
            });
          }

          if (!video.paused && video.readyState >= 2) {
            if (video.currentTime === lastCurrentTime && video.currentTime > 0) {
              // Check if we are actually downloading data
              if (isBuffering && video.networkState === 2) {
                console.log('[Native Player] Buffering data... processing (Stall count paused)');
                // Do not increase stall count if we are actively buffering
                stallCount = 0;
                return;
              }

              stallCount++;
              console.log(`[Native Player] Stalled for ${stallCount}s`);

              // Intermediate recovery attempt: Try to nudge player
              if (stallCount === 10 || stallCount === 20) {
                console.log('[Native Player] Attempting soft resume (play)...');
                video.play().catch(() => { });
              }

              if (stallCount >= maxStallCount) {
                console.warn('[Native Player] Max stall reached, triggering hard reload...');
                stallCount = 0;
                hardReload();
              }
            } else {
              if (stallCount > 0) console.log('[Native Player] Playback resumed');
              stallCount = 0;
              lastCurrentTime = video.currentTime;
            }
          } else {
            stallCount = 0; // Reset if paused or not ready
            lastCurrentTime = video.currentTime;
          }
        }, 1000);

        // Start Playback
        video.volume = this.volume || 1.0;
        video.muted = false;

        try {
          await video.play();
        } catch (err) {
          if (err.name !== 'AbortError') console.error('[Native Player] Play error:', err);
        }

        return; // Exit early, do NOT use mpegts.js
      }

      // END OF NATIVE PLAYER CODE


      // For all WebOS versions, use mpegts.js
      if (mpegts.isSupported()) {
        // FIXED: Better mpegts.js configuration
        this.mpegtsPlayer = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: proxiedStreamUrl,
          cors: true
        }, {
          // --- CONFIGURATION FROM WORKING WEB PLAYER ---
          // Reference: https://github.com/khalidhardiansyah/iptv_web_player

          enableWorker: true,
          lazyLoadMaxDuration: 3 * 60,
          seekType: 'range',

          // Optimized for stable playback with larger buffers
          liveBufferLatencyChasing: false, // Disable aggressive latency chasing
          liveBufferLatencyMaxLatency: 5, // Increased from 1.5 to 5 seconds
          liveBufferLatencyMinRemain: 1, // Increased from 0.3 to 1 second

          stashInitialSize: 1024, // 1MB (1024KB) - SAME AS WEB PLAYER
          enableStashBuffer: true,

          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 30, // Increased from 10 to 30 seconds
          autoCleanupMinBackwardDuration: 10, // Increased from 5 to 10 seconds

          enableWorkerForMSE: true // v1.8.0 feature
        });

        this.mpegtsPlayer.attachMediaElement(video);
        const currentSessionId = this.playbackSessionId;

        // WEBOS 25 FIX: Don't force restart on Early-EOF
        // Let mpegts.js handle recovery naturally
        this.mpegtsPlayer.on(mpegts.Events.ERROR, (type, details) => {
          console.error('[mpegts] Error Event:', type, details);

          // CRITICAL: Do NOT retry on Early-EOF for WebOS 25
          // The player can recover naturally, forcing restart causes loop
          if (details === mpegts.ErrorDetails.NETWORK_EARLY_EOF || (typeof details === 'string' && details.includes('Early-EOF'))) {
            console.warn('[mpegts] Early-EOF detected, letting player recover naturally...');
            // DO NOT RESTART - let mpegts.js auto-recover
            return;
          }

          // Only handle fatal errors that player cannot recover from
          this.handlePlayerError(type, details, currentSessionId);
        });

        // ADDED: Network error handling
        this.mpegtsPlayer.on(mpegts.Events.IO_ERROR, (detail, info) => {
          console.error('[mpegts] IO Error:', detail, info);
        });

        // ADDED: Loading stats
        this.mpegtsPlayer.on(mpegts.Events.STATISTICS_INFO, (stats) => {
          // console.log('[mpegts] Stats:', 'Speed:', stats.speed, 'Current:', stats.currentSegmentIndex);
        });

        // Ensure volume is set when player is ready
        video.volume = this.volume || 1.0;
        video.muted = false;

        this.mpegtsPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
          // Live stream ended = error for live tv
          this.handlePlayerError(mpegts.Events.ERROR, "STREAM_ENDED", currentSessionId);
        });

        video.addEventListener("waiting", () => {
          // Only show buffering if main loader is not visible
          if (playerLoading && getComputedStyle(playerLoading).display !== 'none') {
            return;
          }
          if (playerBuffering) playerBuffering.classList.remove("hidden");
        });

        video.addEventListener("playing", () => {
          if (playerLoading) playerLoading.style.display = "none";
          if (playerBuffering) playerBuffering.classList.add("hidden");

          // Ensure global loader is off
          const gLoad = document.getElementById("screen-loading");
          if (gLoad) gLoad.classList.remove("active");

          this.showPlayerControls();
          video.muted = false;
        });

        this.mpegtsPlayer.load();

        // Guard video.play() against interruption errors
        try {
          await video.play();
          // Double check volume after play
          video.muted = false;
          video.volume = this.volume || 1.0;
        } catch (err) {
          // Only log if it's NOT an interruption error
          if (err.name !== 'AbortError' && !err.message.includes('interrupted')) {
            console.error("Video play error:", err);
          }
        }

        // CRITICAL: Stall detection and auto-recovery (FROM WEB PLAYER)
        // Reference: https://github.com/khalidhardiansyah/iptv_web_player
        if (this.stallInterval) clearInterval(this.stallInterval);

        let lastCurrentTime = 0;
        let stallCount = 0;
        const maxStallCount = 5; // Increased from 3 to 5 seconds before recovery

        this.stallInterval = setInterval(() => {
          if (!video || !this.mpegtsPlayer) return;

          // Check if video is stuck
          if (!video.paused && !video.ended && video.readyState >= 2) {
            if (video.currentTime === lastCurrentTime && video.currentTime > 0) {
              stallCount++;
              console.log(`[mpegts] Stalled for ${stallCount}s at ${video.currentTime}`);

              if (stallCount >= maxStallCount) {
                console.warn('[mpegts] Max stall count reached, recovering...');
                try {
                  // WEB PLAYER RECOVERY: unload → load → play
                  this.mpegtsPlayer.unload();
                  this.mpegtsPlayer.load();
                  this.mpegtsPlayer.play();
                  stallCount = 0;
                } catch (e) {
                  console.error('[mpegts] Recovery failed:', e);
                }
              }
            } else {
              if (stallCount > 0) console.log('[mpegts] Playback resumed');
              stallCount = 0;
              lastCurrentTime = video.currentTime;
            }
          } else {
            stallCount = 0;
            lastCurrentTime = video.currentTime;
          }

          // Handle unexpected 'ended' state for live streams
          if (video.ended && !video.paused) {
            console.warn('[mpegts] Live stream ended unexpectedly, recovering...');
            try {
              this.mpegtsPlayer.unload();
              this.mpegtsPlayer.load();
              this.mpegtsPlayer.play();
            } catch (e) {
              console.error('[mpegts] Recovery from ended state failed:', e);
            }
          }
        }, 1000);

        // WEBOS 25 FIX: DISABLE Stuck-at-0 Watchdog
        // This watchdog was causing issues by forcing seek
        // Let the player start naturally
        /*
        if (this.stuckTimer) clearInterval(this.stuckTimer);
        this.stuckTimer = setInterval(() => {
            if (this.mpegtsPlayer && video && !video.paused) {
                if (video.currentTime === 0 && video.readyState >= 2) {
                    console.log("[Watchdog] Detected Stuck at 0, attempting seek-to-live...");
                    try {
                        const buffered = video.buffered;
                        if (buffered.length > 0) {
                            video.currentTime = buffered.end(buffered.length - 1) - 0.5;
                        }
                    } catch (e) { console.error("[Watchdog] Seek error:", e); }
                }
            }
        }, 5000);
        */
      } else {
        throw new Error("MPEG-TS not supported");
      }
    } catch (error) {
      console.error(error);
      playerLoading.style.display = "none";
      const statusEl = document.getElementById("player-status");
      // Don't show "interrupted" or "AbortError" in UI
      if (statusEl && !error.message.includes('interrupted') && error.name !== 'AbortError') {
        statusEl.textContent = error.message;
      }
      this.showPlayerControls();
    }
  }

  handlePlayerError(type, details, sessionId) {
    // Ignore errors from stale sessions
    if (sessionId !== undefined && sessionId !== this.playbackSessionId) return;

    console.log(`Error: ${type} - ${details}`);

    // WEBOS 25 FIX: Reduce retry aggressiveness
    // Ignore interruption errors
    if (typeof details === 'string' && (details.includes('interrupted') || details.includes('AbortError'))) {
      return;
    }

    // CRITICAL: Don't retry on Early-EOF - it's not a fatal error
    if (typeof details === 'string' && (details.includes('Early-EOF') || details.includes('STREAM_ENDED'))) {
      console.log('[Error] Early-EOF/StreamEnded detected, but player should auto-recover');
      // DO NOT RETRY - this causes the loop
      return;
    }

    // Retry logic for other errors
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const playerLoading = document.getElementById("player-loading");
      const playerLoadingText = document.getElementById("player-loading-text");

      // Only show loading screen if overlay is NOT active (silent retry when overlay is open)
      if (!this.isOverlayMode) {
        if (playerLoading) playerLoading.style.display = "flex";
        if (playerLoadingText) playerLoadingText.textContent = `Retrying (${this.retryCount})...`;
      } else {
        console.log(`[Silent Retry] Attempt ${this.retryCount}/${this.maxRetries} (overlay active)`);
      }

      if (this.mpegtsPlayer) {
        try { this.mpegtsPlayer.destroy(); } catch (e) { }
        this.mpegtsPlayer = null;
      }

      setTimeout(() => {
        if (this.playbackSessionId === sessionId) {
          this.playChannel(this.currentChannel, this.currentChannelIndex, true);
        }
      }, 2000);
    } else {
      const statusEl = document.getElementById("player-status");
      if (statusEl) statusEl.textContent = "Stream Failed (Max Retries)";

      // USER FIX: Show visible error message to user
      const errorMsg = document.createElement('div');
      errorMsg.style.position = 'absolute';
      errorMsg.style.top = '50%';
      errorMsg.style.left = '50%';
      errorMsg.style.transform = 'translate(-50%, -50%)';
      errorMsg.style.background = 'rgba(0,0,0,0.8)';
      errorMsg.style.color = 'white';
      errorMsg.style.padding = '20px';
      errorMsg.style.borderRadius = '10px';
      errorMsg.style.zIndex = '100';
      errorMsg.textContent = "Channel Unavailable. Please try another channel.";
      errorMsg.id = "player-fatal-error";

      const playerScreen = document.getElementById("screen-player");
      const existingErr = document.getElementById("player-fatal-error");
      if (existingErr) existingErr.remove();
      playerScreen.appendChild(errorMsg);

      const playerLoading = document.getElementById("player-loading");
      if (playerLoading) playerLoading.style.display = "none";
    }
  }



  async playVodItem(item, itemIndex = -1) {
    // Check for Series
    if (this.isSeriesItem(item)) {
      console.log("[playVodItem] Item is a series, showing episodes...");
      this.showSeriesEpisodes(item);
      return;
    }

    this.pushScreen("player");
    this.currentChannelIndex = itemIndex;
    this.isVodContent = true;

    // UI Setup for VOD
    const playerScreen = document.getElementById("screen-player");
    playerScreen.classList.add("vod-mode");

    // Explicitly hide Live TV elements
    document.getElementById("player-channel-number").textContent = "";
    document.getElementById("player-channel-logo").src = "";
    document.querySelector(".player-channel-brand").style.display = "none";
    document.querySelector(".player-channel-name").style.display = "none";
    document.querySelector(".player-epg-title").style.display = "none";

    // Show Unified VOD controls
    document.getElementById("vod-controls").classList.remove("hidden");
    document.querySelector(".player-hints").style.display = "none";

    // Set Metadata
    document.getElementById("player-vod-title").textContent = item.name || item.title || "Unknown Title";
    document.getElementById("player-vod-episode").textContent = ""; // Clear episode info for movies

    const video = document.getElementById("video-player");
    const playerLoading = document.getElementById("player-loading");
    const playerLoadingText = document.getElementById("player-loading-text");

    // Remove any leftover fatal error element from a previous failed attempt
    const existingErr = document.getElementById("player-fatal-error");
    if (existingErr) existingErr.remove();

    // FIXED: Show loading UI for VOD
    if (playerLoading) {
      playerLoading.style.display = "flex";
      playerLoadingText.textContent = "Loading VOD...";
    }

    try {
      playerLoadingText.textContent = "Getting VOD link...";
      console.log("[playVodItem] Calling createVodLink with cmd:", item.cmd);
      let streamUrlData = await this.stalkerClient.createVodLink(item.cmd);
      console.log("[playVodItem] createVodLink returned:", streamUrlData);

      let streamUrl = "";
      let meta = {};

      if (streamUrlData === null || streamUrlData === undefined) {
        console.error("[playVodItem] createVodLink returned null/undefined");
        throw new Error("VOD link creation failed - no response from server");
      }

      if (typeof streamUrlData === 'object' && streamUrlData.url) {
        streamUrl = streamUrlData.url;
        meta = streamUrlData.js || streamUrlData.meta || {}; // Handle both potential wrapper names
      } else if (typeof streamUrlData === 'string') {
        streamUrl = streamUrlData;
      }

      if (!streamUrl || streamUrl.trim() === '') {
        console.error("[playVodItem] Stream URL is empty");
        throw new Error("VOD URL is empty - server returned no playback link");
      }

      console.log("[playVodItem] Stream URL:", streamUrl.substring(0, 100));
      console.log("[playVodItem] Full metadata object:", JSON.stringify(meta).substring(0, 500));

      // Check for External Subtitles (Priority: Service Metadata > Item Data)
      let externalSubs = [];

      // Check item.subtitles first
      if (item.subtitles && Array.isArray(item.subtitles)) {
        console.log("[playVodItem] Found subtitles in item.subtitles:", item.subtitles);
        externalSubs = item.subtitles;
      }

      // Check meta.subtitle (single string)
      if (meta.subtitle && typeof meta.subtitle === 'string') {
        console.log("[playVodItem] Found single subtitle in meta.subtitle:", meta.subtitle);
        externalSubs.push({ url: meta.subtitle, lang: 'en', label: 'Subtitle' });
      }
      // Check meta.subtitles (array)
      else if (meta.subtitles && Array.isArray(meta.subtitles)) {
        console.log("[playVodItem] Found subtitles array in meta.subtitles:", meta.subtitles);
        externalSubs = meta.subtitles;
      }

      console.log("[playVodItem] ===== SUBTITLE DEBUG =====");
      console.log("[playVodItem] Total external subtitles found:", externalSubs.length);
      console.log("[playVodItem] Subtitle details:", JSON.stringify(externalSubs));
      console.log("[playVodItem] ===========================");



      console.log("[playVodItem] VOD URL data obtained");

      // VOD/Movies: Always use direct stream without proxy
      // Proxy is only needed for Live TV streams
      let proxiedStreamUrl = streamUrl;
      console.log("[playVodItem] Using direct stream (no proxy for VOD)");

      // 3. Cleanup previous players
      if (this.mpegtsPlayer) {
        this.mpegtsPlayer.destroy();
        this.mpegtsPlayer = null;
      }
      if (this.hlsPlayer) {
        this.hlsPlayer.destroy();
        this.hlsPlayer = null;
      }

      console.log("[playVodItem] Final URL for Video Source:", proxiedStreamUrl.substring(0, 100));
      playerLoadingText.textContent = "Starting playback...";

      // HLS Check for VOD
      if ((proxiedStreamUrl.includes('.m3u8') || proxiedStreamUrl.includes('type=m3u8')) && Hls.isSupported()) {
        console.log("[playVodItem] Playing VOD with HLS.js");
        this.hlsPlayer = new Hls();
        this.hlsPlayer.loadSource(proxiedStreamUrl);
        this.hlsPlayer.attachMedia(video);
        this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function () {
          video.play();
        });

        // Re-add External Subtitles
        if (externalSubs && externalSubs.length > 0) {
          externalSubs.forEach((sub, idx) => {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = sub.title || sub.lang || `External Sub ${idx + 1}`;
            track.srclang = sub.lang || 'en';
            track.src = sub.url;
            video.appendChild(track);
          });
        }
        return;
      }

      // Use <source> element for better compatibility with WebOS Native Player
      video.removeAttribute('src');
      while (video.firstChild) {
        video.removeChild(video.firstChild); // Clear existing sources/tracks
      }

      const source = document.createElement('source');
      source.src = proxiedStreamUrl;

      // Attempt to set type attribute based on URL
      if (proxiedStreamUrl.indexOf('.mkv') !== -1) source.type = "video/x-matroska";
      else if (proxiedStreamUrl.indexOf('.ts') !== -1) source.type = "video/mp2t";
      else if (proxiedStreamUrl.indexOf('.mp4') !== -1) source.type = "video/mp4";
      else source.type = "video/mp4"; // Default fallback

      console.log("[playVodItem] Created source element with type:", source.type);
      video.appendChild(source);

      // Re-add External Subtitles (moved after clearing children)
      if (externalSubs && externalSubs.length > 0) {
        externalSubs.forEach((sub, idx) => {
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = sub.title || sub.lang || `External Sub ${idx + 1}`;
          track.srclang = sub.lang || 'en';
          track.src = sub.url;
          video.appendChild(track);
        });
      }

      video.load(); // Load AFTER setting header

      // FIXED: Dual Subtitle Support (External + Internal)
      const onLoadedMetadata = () => {
        console.log("[loadedmetadata] Duration:", video.duration);

        // 1. External Subtitles from JSON (if any)
        if (externalSubs && externalSubs.length > 0) {
          console.log("[playVodItem] Adding external subtitles from JSON...");
          externalSubs.forEach((sub, idx) => {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = sub.label || sub.lang || `External ${idx + 1}`;
            track.srclang = sub.lang || 'en';
            track.src = sub.url;
            track.mode = 'hidden'; // Default to hidden
            video.appendChild(track);
          });
        }

        // 2. Internal Subtitles from MKV (video.textTracks)
        // WebOS populates video.textTracks asynchronously for MKV.
        console.log(`[playVodItem] Checking for internal text tracks...`);
        console.log(`[playVodItem] video.textTracks.length: ${video.textTracks ? video.textTracks.length : 0}`);

        if (video.textTracks && video.textTracks.length > 0) {
          console.log(`[playVodItem] ✅ Found ${video.textTracks.length} internal text tracks (MKV embedded)`);
          for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            console.log(`[playVodItem]   Track ${i}: ${track.label || track.language || 'Unknown'} (${track.kind})`);
          }
        } else {
          console.log(`[playVodItem] ⚠️ No internal text tracks found yet (may load later for MKV)`);
        }

        // Check again after 1 second (MKV tracks may load asynchronously)
        setTimeout(() => {
          console.log(`[playVodItem] Re-checking text tracks after 1s...`);
          console.log(`[playVodItem] video.textTracks.length: ${video.textTracks ? video.textTracks.length : 0}`);
          if (video.textTracks && video.textTracks.length > 0) {
            console.log(`[playVodItem] ✅ Now found ${video.textTracks.length} text tracks`);
            for (let i = 0; i < video.textTracks.length; i++) {
              const track = video.textTracks[i];
              console.log(`[playVodItem]   Track ${i}: ${track.label || track.language || 'Unknown'}`);
            }
          }
        }, 1000);
      };

      const onPlaying = () => {
        console.log("[playVodItem] Video started playing.");
        if (playerLoading) playerLoading.style.display = "none";
        const gLoad = document.getElementById("screen-loading");
        if (gLoad) gLoad.classList.remove("active");
        video.muted = false;
        video.volume = this.volume || 1.0;
      };

      const onError = (e) => {
        const err = video.error;
        console.error("[Video Error Event]", "code:", err ? err.code : "null", "Msg:", err ? err.message : "null");
        console.error(`[Video State] Network: ${video.networkState}, Ready: ${video.readyState}, CurrentTime: ${video.currentTime}`);

        // Hide loading
        if (playerLoading) playerLoading.style.display = "none";

        // Show error
        const statusEl = document.getElementById("player-status");
        if (statusEl) {
          let errorMsg = "Playback Error";
          if (err) {
            switch (err.code) {
              case 1: errorMsg = "Aborted"; break;
              case 2: errorMsg = "Network Error"; break;
              case 3: errorMsg = "Decode Error - Format Not Supported"; break;
              case 4: errorMsg = "Source Not Supported"; break;
              default: errorMsg = err.message || "Unknown Error";
            }
          }
          statusEl.textContent = errorMsg;
        }
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      video.addEventListener('playing', onPlaying, { once: true });
      video.addEventListener('error', onError, { once: true });

      // Fallback: Hide loading on canplay event
      video.addEventListener('canplay', () => {
        console.log("[playVodItem] canplay event fired");
        if (playerLoading && playerLoading.style.display !== 'none') {
          playerLoadingText.textContent = "Ready - starting...";
        }
      }, { once: true });

      // Handle Buffering UI for VOD
      const onWaiting = () => {
        // Only show buffering if main loader is not visible
        const playerBuffering = document.getElementById("player-buffering");
        const playerLoading = document.getElementById("player-loading");

        if (playerLoading && getComputedStyle(playerLoading).display !== 'none') {
          return;
        }
        if (playerBuffering) playerBuffering.classList.remove("hidden");
      };
      video.addEventListener('waiting', onWaiting);

      // Clean up waiting listener on playing
      video.addEventListener('playing', () => {
        video.removeEventListener('waiting', onWaiting);
        const pb = document.getElementById("player-buffering");
        if (pb) pb.classList.add("hidden");
      });

      this.setupVodControls();

      try {
        await video.play();
      } catch (e) {
        console.error("Native play() failed:", e.name, e.message);
        if (e.name !== 'AbortError') {
          if (playerLoading) playerLoading.style.display = "none";
          const statusEl = document.getElementById("player-status");
          if (statusEl) statusEl.textContent = "Play Failed: " + e.message;
        }
      }

    } catch (e) {
      console.error("VOD Playback Error:", e);
      if (playerLoading) playerLoading.style.display = "none";
      const statusEl = document.getElementById("player-status");
      if (statusEl) statusEl.textContent = "Failed to load VOD: " + (e.message || "Unknown error");
    }
  }

  handleVodKey(keyName) {
    const video = document.getElementById("video-player");
    if (!video) return;

    switch (keyName) {
      case 'Left':
      case 'Rewind': // Media Key
        video.currentTime = Math.max(0, video.currentTime - 10);
        this.showPlayerControls();
        break;
      case 'Right':
      case 'FastForward': // Media Key
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        this.showPlayerControls();
        break;
      case 'Enter':
      case 'OK':
      case 'Play': // Media Key
      case 'Pause': // Media Key
      case 'PlayPause':
        if (video.paused) {
          video.play();
          document.getElementById("vod-play-pause").textContent = "⏸️ Pause";
          this.showPlayerControls();
        } else {
          video.pause();
          document.getElementById("vod-play-pause").textContent = "▶️ Play";
          this.showPlayerControls(); // Keep controls visible when paused
        }
        break;
      case 'Stop': // Media Key
        this.handleBack();
        break;
      case 'Back':
        this.handleBack();
        break;
    }
  }

  // Helper to detect if item is a series
  isSeriesItem(item) {
    // Stalker logic: Usually 'series' property is non-empty, or 'is_series' flag
    // We check multiple potential flags
    if (item.is_series && (item.is_series === 1 || item.is_series === true)) return true;
    if (item.series && item.series.length > 0) return true;
    // Some portals mark it via 'cmd' structure, but usually the flag is reliable
    return false;
  }

  async showSeriesEpisodes(seriesItem) {
    console.log("Showing episodes for:", seriesItem.name);

    // 1. Show Loading
    document.getElementById("screen-loading").classList.add("active");
    document.querySelector("#screen-loading .loading-text").textContent = "Loading Episodes...";

    try {
      // 2. Fetch Episodes
      // We use getSeriesInfo (which usually expects movie_id)
      const response = await this.stalkerClient.getSeriesInfo(seriesItem.id);
      console.log("Episodes Response:", response);

      const episodes = (response && response.data) ? response.data : [];

      if (episodes.length === 0) {
        throw new Error("No episodes found");
      }

      // 3. Create/Show Overlay
      let overlay = document.getElementById("series-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "series-overlay";
        overlay.className = "episode-list-container";
        document.body.appendChild(overlay);
      }

      overlay.innerHTML = `
            <div class="episode-list-header">
                <div class="episode-list-title">${seriesItem.name}</div>
                <div style="color: #94a3b8; margin-top: 5px;">${episodes.length} Episodes</div>
            </div>
            <div id="episode-grid" class="episode-list-grid"></div>
            <button id="close-episodes" class="btn btn-secondary" style="position:fixed; top: 40px; right: 40px;">Close</button>
         `;

      const grid = overlay.querySelector("#episode-grid");

      episodes.forEach((ep, index) => {
        const card = document.createElement("div");
        card.className = "episode-card";
        card.setAttribute("tabindex", "0");
        card.innerHTML = `
                <div class="episode-title">${ep.name || "Episode " + (index + 1)}</div>
                <div class="episode-number">Episode ${index + 1}</div>
             `;

        card.onclick = () => {
          // Play Episode
          document.body.removeChild(overlay); // Close overlay
          // Modify item to play
          ep.image = seriesItem.screenshot_uri; // Inherit cover
          // Keep series title context
          this.playVodItem({ ...ep, title: seriesItem.name, is_episode: true, episode_name: ep.name });
        };

        grid.appendChild(card);
      });

      document.getElementById("close-episodes").onclick = () => {
        document.body.removeChild(overlay);
        document.getElementById("screen-loading").classList.remove("active");
      };

      // Focus first episode
      setTimeout(() => {
        const first = grid.querySelector(".episode-card");
        if (first) first.focus();
      }, 100);

    } catch (e) {
      console.error("Failed to load episodes:", e);
      alert("Could not load episodes: " + e.message);
    } finally {
      document.getElementById("screen-loading").classList.remove("active");
    }
  }

  setupVodControls() {
    const video = document.getElementById("video-player");
    const playPauseBtn = document.getElementById("vod-play-pause");
    const progressContainer = document.getElementById("vod-progress-container");
    const audioBtn = document.getElementById("vod-audio-btn");
    const subsBtn = document.getElementById("vod-subs-btn");

    // Play/Pause
    playPauseBtn.onclick = () => {
      if (video.paused) { video.play(); playPauseBtn.innerHTML = "⏸️ Pause"; }
      else { video.pause(); playPauseBtn.innerHTML = "▶️ Play"; }
    };

    // Audio Tracks
    audioBtn.onclick = () => {
      this.showTrackSelection('audio');
    };

    // Subtitle Tracks
    subsBtn.onclick = () => {
      this.showTrackSelection('subtitles');
    };

    // Draggable Progress Bar logic
    let isDragging = false;

    const updateProgressFromEvent = (e) => {
      const rect = progressContainer.getBoundingClientRect();
      // Handle both Mouse and Touch events
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));

      // Update Visuals immediately
      const fill = document.getElementById("vod-progress-fill");
      if (fill) fill.style.width = (pct * 100) + "%";

      // Update Time Display Preview (Optional, good UX)
      if (video.duration) {
        const seekTime = video.duration * pct;
        const curM = Math.floor(seekTime / 60);
        const curS = Math.floor(seekTime % 60);
        const totM = Math.floor(video.duration / 60);
        const totS = Math.floor(video.duration % 60);
        const timeText = document.getElementById("vod-time");
        // if (timeText) timeText.textContent = `${curM}:${curS.toString().padStart(2,'0')} / ${totM}:${totS.toString().padStart(2,'0')}`;
      }

      return pct;
    };

    // Mouse Down / Touch Start
    const startDrag = (e) => {
      isDragging = true;
      updateProgressFromEvent(e);
    };

    // Mouse Move / Touch Move
    const onDrag = (e) => {
      if (!isDragging) return;
      e.preventDefault(); // Prevent scrolling
      updateProgressFromEvent(e);
    };

    // Mouse Up / Touch End
    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      const pct = updateProgressFromEvent(e);
      if (video.duration) {
        video.currentTime = video.duration * pct;
      }
    };

    progressContainer.onmousedown = startDrag;
    progressContainer.ontouchstart = startDrag;

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag);

    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }

  showTrackSelection(type) {
    const video = document.getElementById("video-player");
    const overlay = document.getElementById("track-selection-overlay");
    const list = document.getElementById("track-list");
    const closeBtn = document.getElementById("track-close-btn");

    list.innerHTML = "";
    overlay.querySelector(".track-header").textContent = type === 'audio' ? "Select Audio" : "Select Subtitles";

    let tracks = [];
    if (type === 'audio') {
      // Check standard and WebKit-prefixed audio tracks
      const audioTracks = video.audioTracks || video.webkitAudioTracks;

      if (audioTracks && audioTracks.length > 0) {
        for (let i = 0; i < audioTracks.length; i++) {
          // Normalize properties
          const label = audioTracks[i].label || audioTracks[i].language || `Audio ${i + 1}`;
          const lang = audioTracks[i].language || '';
          const enabled = audioTracks[i].enabled;

          tracks.push({
            label: `${label} ${lang ? '(' + lang + ')' : ''}`,
            index: i,
            active: enabled
          });
        }
      }
    } else {
      // Subtitles (TextTracks)
      if (video.textTracks) {
        // Add 'Off' option
        // Check if all are disabled
        let anyRunning = false;
        for (let i = 0; i < video.textTracks.length; i++) {
          if (video.textTracks[i].mode === 'showing') anyRunning = true;
        }

        tracks.push({ label: "Off", index: -1, active: !anyRunning });

        for (let i = 0; i < video.textTracks.length; i++) {
          const t = video.textTracks[i];
          // Filter out metadata tracks if needed, but usually we want subtitles/captions
          if (t.kind === 'metadata') continue;

          const isActive = (t.mode === 'showing');
          tracks.push({
            label: t.label || t.language || `Subtitle ${i + 1}`,
            index: i,
            active: isActive
          });
        }
      }
    }

    if (tracks.length === 0) {
      list.innerHTML = "<div class='track-item'>No tracks available</div>";
    } else {
      tracks.forEach(track => {
        const item = document.createElement("div");
        item.className = `track-item ${track.active ? 'active' : ''}`;
        item.textContent = track.label;
        item.onclick = () => {
          if (type === 'audio') {
            toggleAudioTrack(track.index);
          } else {
            toggleSubtitleTrack(track.index);
          }
          overlay.classList.add("hidden");
          this.showPlayerControls(); // Keep controls visible
        };
        list.appendChild(item);
      });
    }

    overlay.classList.remove("hidden");
    closeBtn.onclick = () => overlay.classList.add("hidden");

    function toggleSubtitleTrack(idx) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'hidden';
      }
      if (idx >= 0) {
        video.textTracks[idx].mode = 'showing';
      }
    }

    function toggleAudioTrack(idx) {
      const audioTracks = video.audioTracks || video.webkitAudioTracks;
      if (audioTracks) {
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = (i === idx);
        }
      }
    }
  }

  updateTrackButtons() {
    const video = document.getElementById("video-player");
    const audioBtn = document.getElementById("vod-audio-btn");
    const subsBtn = document.getElementById("vod-subs-btn");

    const audioTracks = video.audioTracks || video.webkitAudioTracks;
    console.log("[updateTrackButtons] Audio:", audioTracks ? audioTracks.length : 0,
      "Subs (TextTracks):", video.textTracks ? video.textTracks.length : 0,
      "Subs (Elements):", video.querySelectorAll('track').length);

    if (audioTracks && (audioTracks.length > 1 || (audioTracks.length === 1 && audioTracks[0].label))) {
      audioBtn.style.opacity = "1";
      audioBtn.disabled = false;
    } else {
      // Keep visible but maybe dimmed if only 1 track? Or just let user see info.
      // User wants to see selection, let's keep it enabled to show 'Audio 1' at least.
      audioBtn.style.opacity = "1";
      audioBtn.disabled = false;
    }

    if (video.textTracks && video.textTracks.length > 0) {
      subsBtn.style.opacity = "1";
      subsBtn.disabled = false;
    } else {
      // Check again in a few seconds in case they load late?
    }
  }

  setupPlayerInteractions() {
    const playerContainer = document.getElementById("screen-player");

    // Wake up controls on any interaction
    const wakeControls = () => {
      if (this.currentScreen === 'player') {
        this.showPlayerControls();
      }
    };

    if (playerContainer) {
      playerContainer.onclick = (e) => {
        if (e.target.closest('.player-controls') || e.target.closest('.vod-controls')) return;
        // Toggle controls on empty space click
        const liveControls = document.getElementById("player-controls");
        const vodControls = document.getElementById("vod-controls");

        const isVisible = (liveControls && liveControls.classList.contains("visible")) ||
          (vodControls && !vodControls.classList.contains("hidden"));

        if (isVisible) this.hidePlayerControls();
        else this.showPlayerControls();
      };

      // Mouse movement wakes controls
      playerContainer.addEventListener('mousemove', () => wakeControls());
    }

    // Global key press wakes controls (if in player)
    document.addEventListener('keydown', () => {
      if (this.currentScreen === 'player') wakeControls();
    });
  }

  volumeUp() {
    this.volume = Math.min(1.0, this.volume + 0.1);
    this.applyVolume();
    this.showPlayerControls();
  }

  volumeDown() {
    this.volume = Math.max(0.0, this.volume - 0.1);
    this.applyVolume();
    this.showPlayerControls();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.applyVolume();
    this.showPlayerControls();
  }

  applyVolume() {
    const video = document.getElementById("video-player");
    if (video) {
      video.volume = this.volume;
      video.muted = this.isMuted;
    }
    this.updateVolumeDisplay();
  }

  updateVolumeDisplay() {
    const volumeFill = document.getElementById("volume-fill");
    const volumeText = document.getElementById("volume-text");
    if (volumeFill) volumeFill.style.width = (this.volume * 100) + "%";
    if (volumeText) volumeText.textContent = Math.round(this.volume * 100) + "%";
  }

  nextChannel() {
    if (this.currentChannelIndex >= this.currentChannelList.length - 1) return;
    this.playChannel(this.currentChannelList[this.currentChannelIndex + 1], this.currentChannelIndex + 1);
  }

  previousChannel() {
    if (this.currentChannelIndex <= 0) return;
    this.playChannel(this.currentChannelList[this.currentChannelIndex - 1], this.currentChannelIndex - 1);
  }

  showSubtitleMenu() {
    const video = document.getElementById("video-player");
    if (!video) return;

    // Get all text tracks (subtitles)
    const tracks = Array.from(video.textTracks || []);

    console.log("[showSubtitleMenu] Total text tracks:", tracks.length);
    tracks.forEach((track, i) => {
      console.log(`[showSubtitleMenu] Track ${i}:`, {
        kind: track.kind,
        label: track.label,
        language: track.language,
        mode: track.mode
      });
    });

    if (tracks.length === 0) {
      console.log("[showSubtitleMenu] No subtitles available");
      // Show a message instead of returning silently
      alert("No subtitles found in this video.\n\nFor MKV files, subtitles should be detected automatically.\nIf you see this message, the video may not contain embedded subtitles.");
      return;
    }

    // Create subtitle menu overlay
    let menu = document.getElementById("subtitle-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "subtitle-menu";
      menu.className = "subtitle-menu";
      menu.innerHTML = `
        <div class="subtitle-menu-content">
          <h3>Select Subtitle</h3>
          <div class="subtitle-list"></div>
          <button class="subtitle-close-btn" data-focusable="true">Close</button>
        </div>
      `;
      document.body.appendChild(menu);
    }

    const list = menu.querySelector(".subtitle-list");
    list.innerHTML = "";

    // Add "Off" option
    const offBtn = document.createElement("button");
    offBtn.className = "subtitle-item";
    offBtn.textContent = "Off";
    offBtn.setAttribute("data-focusable", "true");
    offBtn.addEventListener("click", () => {
      tracks.forEach(track => track.mode = "disabled");
      console.log("[showSubtitleMenu] All subtitles disabled");
      menu.classList.remove("active");
      this.navigation.updateFocusableElements();
    });
    list.appendChild(offBtn);

    // Add subtitle options
    tracks.forEach((track, index) => {
      const btn = document.createElement("button");
      btn.className = "subtitle-item";
      btn.textContent = track.label || track.language || `Subtitle ${index + 1}`;
      btn.setAttribute("data-focusable", "true");

      if (track.mode === "showing") {
        btn.classList.add("active");
      }

      btn.addEventListener("click", () => {
        // Disable all tracks
        tracks.forEach(t => t.mode = "disabled");
        // Enable selected track
        track.mode = "showing";
        console.log(`[showSubtitleMenu] Enabled subtitle: ${track.label || track.language}`);
        menu.classList.remove("active");
        this.navigation.updateFocusableElements();
      });

      list.appendChild(btn);
    });

    // Close button
    const closeBtn = menu.querySelector(".subtitle-close-btn");
    closeBtn.addEventListener("click", () => {
      menu.classList.remove("active");
      this.navigation.updateFocusableElements();
    });

    // Show menu
    menu.classList.add("active");
    this.navigation.updateFocusableElements();

    // Focus first item
    setTimeout(() => {
      const firstItem = list.querySelector(".subtitle-item");
      if (firstItem) firstItem.focus();
    }, 100);
  }

  // Note: setupVodControls is defined earlier (around line 2053) with full implementation

  stopPlayer() {
    if (this.mpegtsPlayer) {
      this.mpegtsPlayer.destroy();
      this.mpegtsPlayer = null;
    }
    const video = document.getElementById("video-player");
    video.pause();
    video.src = "";
    document.getElementById("player-loading").style.display = "none";
  }

  handleBack() {
    // Check overlay state
    const isAttributeActive = document.body.getAttribute("data-overlay-active") === "true";
    if (isAttributeActive || this.isOverlayMode) {
      this.closeOverlay();
      return;
    }
    if (this.currentScreen === 'player') {
      this.stopPlayer();
      // Always go back to 'main' list when exiting player content
      this.showScreen('main');
      if (this.isVodContent) {
        document.getElementById("screen-player").classList.remove("vod-mode");
        // Restore Live TV UI elements for next time
        document.querySelector(".player-channel-brand").style.display = "flex";
        document.querySelector(".player-channel-name").style.display = "block";
        document.querySelector(".player-epg-title").style.display = "block";
      }
      return;
    }
    if (this.screenHistory.length > 0) {
      this.popScreen();
      return;
    }
    this.showExitConfirmation();
  }

  handlePlayerOK() {
    const controls = document.getElementById("player-controls");
    if (!controls.classList.contains("visible")) this.showPlayerControls();
    else this.enterOverlayMode();
  }

  showPlayerControls(duration = 3000) {
    const video = document.getElementById("video-player");
    const liveControls = document.getElementById("player-controls");
    const vodControls = document.getElementById("vod-controls");

    // Show appropriate controls
    if (this.isVodContent) {
      if (vodControls) vodControls.classList.remove("hidden");
      // Also show/update hints if needed, or hide them
    } else {
      if (liveControls) liveControls.classList.add("visible");
    }

    if (this.controlsTimer) clearTimeout(this.controlsTimer);

    // auto-hide only if playing
    if (video && !video.paused) {
      this.controlsTimer = setTimeout(() => this.hidePlayerControls(), duration);
    }
  }

  hidePlayerControls() {
    const video = document.getElementById("video-player");
    // Don't hide if paused (Netflix/YouTube behavior)
    if (video && video.paused) return;

    const liveControls = document.getElementById("player-controls");
    const vodControls = document.getElementById("vod-controls");

    if (liveControls) liveControls.classList.remove("visible");
    if (vodControls) vodControls.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
});