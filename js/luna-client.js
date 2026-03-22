// Luna Bus Client - WebOS Service Communication
class LunaClient {
  constructor(serviceName) {
    this.serviceName = serviceName || 'com.iptv.khalid.service';
    this.bridge = null;
    this.init();
  }

  init() {
    // Check if webOS is available
    if (typeof webOS !== 'undefined' && webOS.service) {
      this.bridge = webOS.service;
      console.log('Luna Bus bridge initialized');
    } else {
      console.warn('webOS service bridge not available - running in browser mode');
    }
  }

  logToScreen(msg) {
    console.log(msg);
    const consoleEl = document.getElementById('debug-console');
    if (consoleEl) {
        consoleEl.style.display = 'block';
        const line = document.createElement('div');
        line.textContent = `[LUNA] ${msg}`;
        line.style.borderBottom = '1px solid #333';
        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  call(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.bridge) {
        this.logToScreen('Error: Luna Bus not available');
        reject(new Error('Luna Bus not available'));
        return;
      }

      // Reverted to original working format
      const uri = `luna://${this.serviceName}/`;
      
      this.logToScreen(`Calling: ${method}`);
      
      // FIXED: Increased timeout to 30s for VOD operations (createVodLink can be slow)
      const timeout = setTimeout(() => {
        this.logToScreen(`Timeout: ${method} after 30s`);
        reject(new Error('Luna service call timeout'));
      }, 30000);
      
      // Reverted: method is a separate parameter
      this.bridge.request(uri, {
        method: method,
        parameters: params,
        onSuccess: (response) => {
          clearTimeout(timeout);
          this.logToScreen(`Success: ${method} (Ret: ${response.returnValue})`);
          if (response.returnValue) {
            resolve(response);
          } else {
            this.logToScreen(`Service Logic Fail: ${response.errorText}`);
            reject(new Error(response.errorText || 'Service call failed'));
          }
        },
        onFailure: (error) => {
          clearTimeout(timeout);
          this.logToScreen(`Luna Failure: ${error.errorText || error.message} (${error.errorCode || 'unknown'})`);
          console.error('[LunaClient] Failure:', error);
          reject(new Error(error.errorText || error.message || 'Service call failed'));
        }
      });
    });
  }

  async stalkerRequest(action, baseUrl, mac, params = {}) {
    try {
      const response = await this.call('stalkerRequest', {
        action: action,
        baseUrl: baseUrl,
        mac: mac,
        params: params
      });
      
      // Return the data field from the response
      return response.data || response;
    } catch (error) {
      console.error('Luna stalkerRequest failed:', error);
      throw error;
    }
  }

  async xtreamRequest(action, baseUrl, username, password, params = {}) {
    try {
      const response = await this.call('xtreamRequest', {
        action: action,
        baseUrl: baseUrl,
        username: username,
        password: password,
        params: params
      });
      
      // Return the data field from the response
      return response.data || response;
    } catch (error) {
      console.error('Luna xtreamRequest failed:', error);
      throw error;
    }
  }

  async streamProxy(streamUrl, baseUrl, mac) {
    try {
      const response = await this.call('streamProxy', {
        url: streamUrl,
        baseUrl: baseUrl,
        mac: mac
      });
      // The service returns 'proxyUrl', not 'proxiedUrl'
      return response.proxyUrl || streamUrl;
    } catch (error) {
      console.error('Luna streamProxy failed:', error);
      return streamUrl; // Fallback to original URL
    }
  }

  async heartbeat() {
    try {
      const response = await this.call('heartbeat', {});
      return response;
    } catch (error) {
      console.error('Luna heartbeat failed:', error);
      return null;
    }
  }
}

window.LunaClient = LunaClient;