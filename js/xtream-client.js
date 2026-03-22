// Xtream Client - Frontend wrapper for Luna Service
class XtreamClient {
  constructor() {
    // Load portal config from sessionStorage (set by home screen)
    const portalData = sessionStorage.getItem('selectedPortal');

    if (!portalData) {
      console.error('No portal selected! Redirecting to home...');
      window.location.href = 'home.html';
      return;
    }

    try {
      const portal = JSON.parse(portalData);

      // Validate portal type
      if (portal.type !== 'xtream') {
        console.error('This client only supports Xtream portals');
        window.location.href = 'home.html';
        return;
      }

      // Set portal credentials from database
      this.baseUrl = portal.server;
      this.username = portal.username;
      this.password = portal.password;
      this.portalName = portal.name;
      this.portalId = portal.id;

      // For compatibility with app.js
      this.portalUrl = portal.server;
      this.mac = null; // Xtream doesn't use MAC

      console.log('Loaded Xtream portal:', this.portalName);
    } catch (error) {
      console.error('Failed to parse portal data:', error);
      window.location.href = 'home.html';
      return;
    }

    // Check if Luna Bus is available
    this.useLuna = typeof webOS !== "undefined" && webOS.service;

    if (this.useLuna) {
      this.lunaClient = new LunaClient('com.iptv.khalid.service');
    }

    // Cache for pagination (Xtream API returns all channels at once)
    this._channelCache = {};
    this._cacheExpiry = {};
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.PAGE_SIZE = 50; // Items per page for lazy load
  }

  async callService(action, params = {}) {
    if (this.useLuna) {
      // Call Luna Service xtreamRequest
      return await this.lunaClient.xtreamRequest(action, this.baseUrl, this.username, this.password, params);
    } else {
      throw new Error("WebOS Service not available");
    }
  }

  async handshake() {
    try {
      console.log("Xtream Authenticating...");
      await this.callService('authenticate');
      return true;
    } catch (error) {
      console.error("Xtream Auth FAILED:", error.message);
      return false;
    }
  }

  async getProfile() {
    return { success: true };
  }

  async getGenres() {
    try {
      const data = await this.callService('categories');
      // Normalize Xtream format to Stalker-compatible format
      return (data || []).map(cat => ({
        id: (cat.category_id && cat.category_id.toString()) || cat.id || '',
        title: cat.category_name || cat.title || 'Unknown',
        name: cat.category_name || cat.name || 'Unknown',
        censored: 0 // Xtream doesn't provide channel count
      }));
    } catch (error) {
      console.error("Get Xtream categories failed:", error);
      return [];
    }
  }


  async getChannels(categoryId, page) {
    page = page || 1; // Default to page 1
    const cacheKey = categoryId || '*';
    const now = Date.now();

    try {
      // Check if we need to fetch fresh data
      if (!this._channelCache[cacheKey] || this._cacheExpiry[cacheKey] < now) {
        console.log(`[Xtream] Fetching all channels for category: ${cacheKey}`);
        const data = await this.callService('channels', { categoryId: categoryId || '*' });

        // Normalize Xtream format to Stalker-compatible format
        this._channelCache[cacheKey] = (data || []).map((stream, index) => ({
          id: (stream.stream_id && stream.stream_id.toString()) || (stream.num && stream.num.toString()) || stream.id || `ch_${index}`,
          name: stream.name || stream.title || 'Unknown',
          number: (stream.num && stream.num.toString()) || stream.number || (index + 1).toString(),
          cmd: stream.stream_id, // Store stream_id for playback
          logo: stream.stream_icon || stream.logo || null,
          stream_id: stream.stream_id // Keep original for link creation
        }));
        this._cacheExpiry[cacheKey] = now + this.CACHE_TTL;
        console.log(`[Xtream] Cached ${this._channelCache[cacheKey].length} channels for category: ${cacheKey}`);
      }

      // Client-side pagination (Xtream API doesn't support server-side pagination)
      const allChannels = this._channelCache[cacheKey];
      const startIndex = (page - 1) * this.PAGE_SIZE;
      const endIndex = startIndex + this.PAGE_SIZE;
      const pageChannels = allChannels.slice(startIndex, endIndex);

      console.log(`[Xtream] Returning page ${page}: items ${startIndex}-${endIndex} of ${allChannels.length}`);

      return pageChannels;
    } catch (error) {
      console.error("Get Xtream channels failed:", error);
      return [];
    }
  }

  async createLink(streamId) {
    try {
      const response = await this.callService('link', { streamId: streamId });
      // Service returns {url: "..."} for Xtream
      if (response && response.url) {
        return response.url;
      }
      return response; // Fallback if it is already a string
    } catch (error) {
      console.error("Create Xtream link failed:", error);
      throw error;
    }
  }

  async getVodCategories() {
    try {
      const data = await this.callService('vod_categories');
      // Normalize Xtream format to Stalker-compatible format
      return (data || []).map(cat => ({
        id: (cat.category_id && cat.category_id.toString()) || cat.id || '',
        title: cat.category_name || cat.title || 'Unknown',
        name: cat.category_name || cat.name || 'Unknown',
        censored: 0
      }));
    } catch (error) {
      return [];
    }
  }

  async getVodItems(categoryId) {
    try {
      const data = await this.callService('vod_items', { categoryId: categoryId });
      // Normalize Xtream format to Stalker-compatible format
      const normalized = (data || []).map((vod, index) => ({
        id: (vod.stream_id && vod.stream_id.toString()) || (vod.num && vod.num.toString()) || vod.id || `vod_${index}`,
        name: vod.name || vod.title || 'Unknown',
        title: vod.name || vod.title || 'Unknown',
        cmd: vod.stream_id,
        screenshot_uri: vod.stream_icon || vod.cover_big || null,
        cover_big: vod.cover_big || vod.stream_icon || null,
        logo: vod.stream_icon || null,
        stream_id: vod.stream_id
      }));
      return { data: normalized };
    } catch (error) {
      return { data: [] };
    }
  }

  async createVodLink(cmd) {
    try {
      return await this.callService('vod_link', { cmd: cmd });
    } catch (error) {
      return null;
    }
  }

  async search(query) {
    try {
      console.log("Xtream search (mock):", query);
      // Xtream rarely supports server-side search. 
      // We could implement client-side cache search here if needed.
      // For now, return empty to prevent crash.
      return [];
    } catch (error) {
      console.error("Xtream search failed:", error);
      return [];
    }
  }

  async logout() {
    try {
      await this.callService('logout');
    } catch (e) { }
    sessionStorage.removeItem('selectedPortal');
    return true;
  }
}

window.XtreamClient = XtreamClient;
