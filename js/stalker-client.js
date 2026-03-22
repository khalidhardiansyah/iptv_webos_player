// Stalker Client - Frontend wrapper for Luna Service
class StalkerClient {
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
      if (portal.type !== 'stalker') {
        console.error('This client only supports Stalker portals');
        alert('This portal type is not yet supported. Only Stalker portals are currently available.');
        window.location.href = 'home.html';
        return;
      }

      // Set portal credentials from database
      this.portalUrl = portal.url;
      this.mac = portal.mac;
      this.portalName = portal.name;
      this.portalId = portal.id;

      console.log('Loaded portal:', this.portalName);
      console.log('Portal URL:', this.portalUrl);
      console.log('MAC:', this.mac);
    } catch (error) {
      console.error('Failed to parse portal data:', error);
      window.location.href = 'home.html';
      return;
    }

    // Check if Luna Bus is available
    this.useLuna = typeof webOS !== "undefined" && webOS.service;

    if (this.useLuna) {
      this.lunaClient = new LunaClient('com.iptv.khalid.service');
      this.logToScreen("Using Luna Bus");
    } else {
      console.warn("WebOS Service not available and fallback removed.");
      this.logToScreen("Service not available");
    }
  }

  logToScreen(msg) {
    console.log(msg);
    const consoleEl = document.getElementById('debug-console');
    if (consoleEl) {
      consoleEl.style.display = 'block';
      const line = document.createElement('div');
      line.textContent = `[STALKER] ${msg}`;
      line.style.color = '#aaf';
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }


  async callService(action, params = {}, retry = true) {
    if (this.useLuna) {
      // Call Luna Service
      return await this.lunaClient.stalkerRequest(action, this.portalUrl, this.mac, params);
    } else {
      throw new Error("WebOS Service not available (Proxy removed)");
    }
  }

  async handshake() {
    try {
      this.logToScreen("Starting Handshake...");
      const data = await this.callService('handshake');
      this.logToScreen("Handshake Response Received");
      return true;
    } catch (error) {
      this.logToScreen("Handshake FAILED: " + error.message);
      return false;
    }
  }

  async getProfile() {
    console.log("Profile not needed - handled by service");
    return { success: true };
  }

  async getUserInfo() {
    try {
      console.log("Fetching User Info...");
      const data = await this.callService('getUserInfo');
      console.log("User Info Received:", data);
      return data.info;
    } catch (error) {
      console.error("Get User Info failed:", error);
      return null;
    }
  }

  async getGenres() {
    try {
      const data = await this.callService('categories');
      console.log("Categories loaded:", data.length);
      return data;
    } catch (error) {
      console.error("Get categories failed:", error);
      return [];
    }
  }

  async getChannels(genreId, page) {
    try {
      const p = page || 1;
      const data = await this.callService('channels', { genreId: genreId || '*', p: p });
      console.log(`Channels loaded (Page ${p}):`, data.length);
      return data;
    } catch (error) {
      console.error("Get channels failed:", error);
      return [];
    }
  }

  async search(query) {
    try {
      console.log("Searching for:", query);
      const data = await this.callService('search', { query: query });
      console.log("Search results:", data.length);
      return data;
    } catch (error) {
      console.error("Search failed:", error);
      return [];
    }
  }

  async createLink(channelId, cmd) {
    try {
      // Validate cmd parameter
      if (!cmd || cmd.trim() === '') {
        console.error('createLink: cmd parameter is empty or undefined!');
        console.error('Channel ID:', channelId);
        throw new Error('Channel cmd is missing. This channel may not be playable.');
      }

      console.log('Processing cmd:', cmd.substring(0, 100));

      // IMPORTANT: cmd already contains the stream URL (e.g., "ffmpeg http://server/play/live.php?...")
      // Extract the URL directly instead of calling create_link API which returns empty stream parameter
      let streamUrl = cmd;

      // Remove "ffmpeg " prefix if present
      if (streamUrl.startsWith('ffmpeg ')) {
        streamUrl = streamUrl.substring(7).trim();
        console.log('Removed ffmpeg prefix, URL:', streamUrl.substring(0, 100));
      }

      // USER FIX: Remove incomplete parameters
      if (streamUrl.endsWith('&play_to') || streamUrl.endsWith('&')) {
        streamUrl = streamUrl.replace(/&play_to.*$/, '');
        streamUrl = streamUrl.replace(/&$/, '');
      }

      // FIX: Replace 'localhost' with actual portal authority
      if (streamUrl.includes('//localhost')) {
        try {
          // Extract hostname from portalUrl (e.g., http://ch-4k-top.org/c/ -> ch-4k-top.org)
          const portalAuth = new URL(this.portalUrl).host;
          streamUrl = streamUrl.replace('//localhost', '//' + portalAuth);
          console.log('Replaced localhost with portal host:', streamUrl);
        } catch (e) {
          console.warn('Failed to replace localhost:', e);
        }
      }

      console.log("Final stream URL:", streamUrl ? streamUrl.substring(0, 100) : 'null');

      // If we need to call the server to get a temporary link, do it here.
      // But standard Stalker usually works with the cmd URL directly if authenticated.
      // If broken, uncomment below:
      /*
      if (streamUrl.includes('localhost') || !streamUrl.startsWith('http')) {
           const remoteUrl = await this.callService('link', { cmd: cmd }); // Use Original full CMD
           if (remoteUrl) return remoteUrl;
      }
      */

      // Check for clearly truncated / broken URLs
      // If it ends with a parameter key but no value (e.g. &play_t), or is just too short/weird
      const isTruncated = streamUrl.match(/&[a-zA-Z0-9_]+$/) || streamUrl.endsWith('_t');

      // Check if URL is valid or needs regeneration
      if (isTruncated || (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://'))) {
        console.warn('cmd appears invalid or truncated (' + streamUrl.substring(streamUrl.length - 20) + '), calling create_link API...');
        // Fallback to API call
        streamUrl = await this.callService('link', { cmd: cmd });
      }

      console.log("Final stream URL:", streamUrl ? streamUrl.substring(0, 100) : 'null');
      return streamUrl;
    } catch (error) {
      console.error("Create link failed:", error);
      throw error; // Re-throw to let playChannel handle it (including retries)
    }
  }

  async getEpg(channelId, period) {
    console.log("EPG not implemented");
    return [];
  }

  async getCurrentEpg(channelId) {
    console.log("Current EPG not implemented");
    return null;
  }

  // VOD Methods
  async getVodCategories() {
    try {
      const data = await this.callService('vod_categories');
      console.log("VOD Categories loaded:", data.length);
      return data;
    } catch (error) {
      console.error("Get VOD categories failed:", error);
      return [];
    }
  }

  async getVodItems(categoryId, page = 1) {
    try {
      // For searching, if categoryId looks like a search query (not a number), we might need to handle it differently
      // keeping consistent with backend params
      const data = await this.callService('vod_items', { categoryId: categoryId, page: page });
      console.log(`VOD Items loaded for cat ${categoryId}:`, data.data ? data.data.length : 0);
      return data;
    } catch (error) {
      console.error("Get VOD items failed:", error);
      return {};
    }
  }

  async createVodLink(cmd, vodId) {
    try {
      console.log("[createVodLink] Calling service with cmd:", cmd);
      const response = await this.callService('vod_link', { cmd: cmd, vodId: vodId });
      console.log("[createVodLink] Service response:", response);

      let streamUrl = "";
      let meta = {};

      // FIXED: Handle response structure from service correctly
      if (typeof response === 'object' && response.url) {
        streamUrl = response.url;
        // Service returns 'js' field, not 'meta'
        meta = response.js || {};
      } else if (typeof response === 'string') {
        streamUrl = response;
      }

      if (streamUrl && streamUrl.startsWith('ffmpeg ')) {
        streamUrl = streamUrl.substring(7).trim();
      }

      console.log("VOD Stream URL:", streamUrl ? streamUrl.substring(0, 100) : 'EMPTY');
      console.log("VOD Metadata keys:", Object.keys(meta));

      if (!streamUrl || streamUrl.trim() === '') {
        throw new Error("Server returned empty VOD URL");
      }

      // Return object containing URL and metadata (including subtitles)
      return {
        url: streamUrl,
        meta: meta
      };
    } catch (error) {
      console.error("Create VOD link failed:", error);
      throw error; // Re-throw instead of returning null
    }
  }

  async getSeriesInfo(vodId) {
    try {
      const data = await this.callService('series_info', { vodId: vodId });
      console.log("Series info loaded");
      return data;
    } catch (error) {
      console.error("Get series info failed:", error);
      return {};
    }
  }

  async searchVod(query) {
    try {
      console.log("Searching VOD for:", query);
      const data = await this.callService('vod_search', { query: query });
      console.log("VOD Search results:", data.data ? data.data.length : 0);
      return data;
    } catch (error) {
      console.error("VOD Search failed:", error);
      return {};
    }
  }


  async logout() {
    try {
      console.log("Logging out from portal...");
      await this.callService('logout');
    } catch (e) {
      console.warn("Logout service call failed (ignoring):", e);
    }

    // Clear local session data
    sessionStorage.removeItem('selectedPortal');
    // We might want to clear other things if needed
    console.log("Local session cleared.");
    return true;
  }
}

window.StalkerClient = StalkerClient;