/*
 * Copyright (c) 2024 LG Electronics Inc.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-var */
/* eslint-disable import/no-unresolved */
var pkgInfo = require('./package.json');
var Service = require('webos-service');
var http = require('http');
var https = require('https');
var url = require('url');

// Create HTTP agents
// DISABLE keepAlive to prevent ECONNRESET on buggy Stalker servers
// Many IPTV middlewares drop idle connections aggressively
var httpAgent = new http.Agent({ 
	keepAlive: false,
	maxSockets: 50,
	timeout: 30000
});

var httpsAgent = new https.Agent({ 
	keepAlive: false,
	maxSockets: 50,
	timeout: 30000,
    rejectUnauthorized: false, // IMPORTANT: Allow self-signed certs
    minVersion: 'TLSv1' // maximize compatibility for old servers
});

var service = new Service(pkgInfo.name);
// Timeout for Stalker Requests
var STALKER_TIMEOUT = 30000;

console.log('[Service] ===== SERVICE STARTING =====');
console.log('[Service] Service name:', pkgInfo.name);
console.log('[Service] Version:', pkgInfo.version);

// Prevent service crash on unhandled errors
process.on('uncaughtException', function(err) {
	console.error('[Service] ===== UNCAUGHT EXCEPTION =====');
	console.error('[Service] Error:', err.message);
	console.error('[Service] Stack:', err.stack);
	console.error('[Service] Code:', err.code);
	console.error('[Service] Errno:', err.errno);
	console.error('[Service] Syscall:', err.syscall);
	console.error('[Service] =====================================');
	// Don't exit - keep service alive
});

// Prevent crash on unhandled promise rejections
process.on('unhandledRejection', function(reason, p) {
	console.error('[Service] ===== UNHANDLED REJECTION =====');
	console.error('[Service] Reason:', reason);
	console.error('[Service] Promise:', p);
	console.error('[Service] =====================================');
	// Don't exit - keep service alive
});

// Store client sessions per MAC address
var clients = {};

// Stalker Client Class
function StalkerClient(baseUrl, mac) {
    this.baseUrl = baseUrl;
    this.mac = mac;
    this.token = null;
    // Gunakan Timezone yang umum & Cookie standar
    this.cookies = ['mac=' + encodeURIComponent(mac), 'stb_lang=en', 'timezone=Europe/Paris'];
    
    // Generate static ID signatures based on MAC to look like a real device
    var cleanMac = mac.replace(/:/g, '').toUpperCase();
    this.serialNumber = cleanMac; // Use MAC as SN (Standard practice for emulators)
    this.deviceId = cleanMac;     // Simplified Device ID
    this.deviceId2 = cleanMac;    // Simplified Device ID 2
    
    console.log('[StalkerClient] Created client for MAC:', mac, 'SN:', this.serialNumber);
    console.log('[StalkerClient] Base URL:', baseUrl);
}

StalkerClient.prototype.makeRequest = function(action, params, method) {
    var self = this;
    var reqMethod = method || 'GET';
    
    var endpoints = [
        'server/load.php',
        'portal.php',
        'stalker_portal/server/load.php'
    ];

    var startIdx = (self.currentEndpointIndex !== undefined) ? self.currentEndpointIndex : 0;

    function tryEndpoint(idx) {
        if (idx >= endpoints.length) {
            return Promise.reject(new Error('All Stalker endpoints failed'));
        }

        var endpoint = endpoints[idx];
        
        return new Promise(function(resolve, reject) {
            function doRequest(currentUrl, redirectCount) {
                if (redirectCount > 5) {
                    reject(new Error('Too many redirects'));
                    return;
                }

                try {
                    var fullUrl = currentUrl;
                    var bodyData = '';
                    
                    if (redirectCount === 0) {
                        var apiUrl = self.baseUrl + endpoint; 
                        var queryParams = ['type=' + encodeURIComponent(action)];
                        
                        // Add params
                        for (var key in params) {
                            if (params.hasOwnProperty(key)) {
                                queryParams.push(key + '=' + encodeURIComponent(params[key]));
                            }
                        }
                        
                        // Force additional standard params for every request (Anti-Ban)
                        if (action !== 'handshake') {
                            if (!params.action) queryParams.push('action=' + encodeURIComponent(action));
                        }

                        if (reqMethod === 'POST' || !method) {
                            reqMethod = 'POST'; 
                            fullUrl = apiUrl;
                            bodyData = queryParams.join('&');
                        } else {
                            fullUrl = apiUrl + '?' + queryParams.join('&');
                        }
                    }

                    console.log('[StalkerClient] Action:', action, 'Endpoint:', endpoint);

                    var isHttps = fullUrl.startsWith('https://');
                    var protocol = isHttps ? https : http;
                    
                    // URL Parsing Manual yang Lebih Aman
                    var urlParts = url.parse(fullUrl);
                    var hostname = urlParts.hostname;
                    var port = urlParts.port || (isHttps ? 443 : 80);
                    var path = urlParts.path;

                    // Header Host yang Benar (Sertakan port jika bukan 80/443)
                    var hostHeader = hostname;
                    if (port !== 80 && port !== 443) {
                        hostHeader = hostname + ':' + port;
                    }
                    
                    // Referer Logic yang ketat
                    var refererUrl = self.baseUrl;
                    if (!refererUrl.endsWith('/')) refererUrl += '/';
                    if (!refererUrl.includes('c/')) refererUrl += 'c/';
                    refererUrl += 'index.html';

                    var requestOptions = {
                        hostname: hostname,
                        port: port,
                        path: path,
                        method: reqMethod,
                        headers: {
                            'Host': hostHeader,
                            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
                            'X-User-Agent': 'Model: MAG250; Link: WiFi',
                            'Accept': '*/*',
                            'Accept-Encoding': 'identity', // Hindari gzip issue di Nodejs simple
                            'Referer': refererUrl,
                            'Cookie': self.cookies.join('; '),
                            'Connection': 'Keep-Alive'
                        },
                        timeout: STALKER_TIMEOUT, 
                        agent: isHttps ? httpsAgent : httpAgent,
                        rejectUnauthorized: false
                    };
                    
                    // Hapus header otomatis Node.js yang sering memicu blokir
                    delete requestOptions.headers['expect'];
                    
                    if (reqMethod === 'POST') {
                        requestOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                        requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
                    }
                    
                    if (self.token) {
                        requestOptions.headers['Authorization'] = 'Bearer ' + self.token;
                    }
                    
                    var req = protocol.request(requestOptions, function(res) {
                        var data = '';
                        
                        // Handle Redirects
                        if ([301, 302, 303, 307].indexOf(res.statusCode) > -1) {
                            var redirectUrl = res.headers['location'];
                            if (redirectUrl) {
                                // Update cookies from redirect
                                if (res.headers['set-cookie']) {
                                    var setCookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
                                    setCookies.forEach(function(cookieStr) {
                                        var cookieValue = cookieStr.split(';')[0].trim();
                                        self.cookies.push(cookieValue);
                                    });
                                }
                                res.resume();
                                
                                // Resolve relative URL
                                if (!redirectUrl.startsWith('http')) {
                                    redirectUrl = (isHttps ? 'https://' : 'http://') + hostname + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
                                }
                                doRequest(redirectUrl, redirectCount + 1);
                                return;
                            }
                        }

                        // Capture Cookies (PENTING: Server sering kirim token di cookie)
                        if (res.headers['set-cookie']) {
                            var setCookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
                            setCookies.forEach(function(cookieStr) {
                                var cookieValue = cookieStr.split(';')[0].trim();
                                self.cookies.push(cookieValue); 
                            });
                        }
                        
                        res.setEncoding('utf8');
                        res.on('data', function(chunk) { data += chunk; });
                        res.on('end', function() {
                             if (res.statusCode >= 400 && res.statusCode !== 444) { // 444 ditangani oleh catch/retry logic
                                reject(new Error('HTTP Error ' + res.statusCode));
                                return;
                            }
                            try {
                                if (!data || data.trim().length === 0) {
                                     // Kadang 444/Empty response berarti server blokir, lempar error agar retry
                                     throw new Error('Empty response (possible 444)');
                                }
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error('JSON Parse Error: ' + e.message + ' Data: ' + data.substring(0, 100)));
                            }
                        });
                    });
                    
                    req.on('error', function(e) { 
                        console.error('[StalkerClient] Request Error:', e.message);
                        reject(e); 
                    });
                    
                    if (reqMethod === 'POST') req.write(bodyData);
                    req.end();
                } catch (e) { reject(e); }
            }
            doRequest('', 0);
        }).then(function(response) {
            self.currentEndpointIndex = idx;
            return response;
        }).catch(function(err) {
            console.warn('[StalkerClient] Action ' + action + ' failed on ' + endpoint + ':', err.message);
            
            // Retry logic untuk ECONNRESET atau 444
            var isRetryable = err.message.includes('404') || err.message.includes('444') || err.message.includes('ECONNRESET') || err.message.includes('socket hang up') || action === 'handshake';
            
            if (isRetryable && idx < endpoints.length - 1) {
                console.log('[StalkerClient] Retrying with next endpoint...');
                return tryEndpoint(idx + 1);
            }
            throw err;
        });
    }

    return tryEndpoint(startIdx);
};

StalkerClient.prototype.handshake = function() {
    var self = this;
    console.log('[StalkerClient] Handshake for MAC:', this.mac, 'SN:', this.serialNumber);
    
    // Randomization yang lebih baik
    var random = Math.floor(Math.random() * 1000000);
    
    // Gunakan parameter yang meniru MAG Box Asli agar tidak di-reset koneksinya
    return this.makeRequest('stb', {
        action: 'handshake',
        type: 'stb',
        token: '',
        mac: this.mac,
        random: random,
        // Parameter Kritis untuk Anti-Ban:
        sn: this.serialNumber,           // JANGAN GUNAKAN 00000
        stb_type: 'MAG250',
        ver: 'ImageDescription: 0.2.18-r14-250',
        image_version: '218',
        auth_second_step: 0,
        hd: 1,
        not_valid_token: 0,
        hw_version: '1.7-BD-00',
        device_id: this.deviceId,        // Beberapa portal wajib ini
        device_id2: this.deviceId2,
        signature: this.deviceId         // Kadang dibutuhkan
    }).then(function(data) {
        if (data && data.js && data.js.token) {
            self.token = data.js.token;
            console.log('[StalkerClient] Handshake Success. Token:', self.token.substring(0, 10) + '...');
        }
        return data;
    });
};

StalkerClient.prototype.getMainInfo = function() {
    console.log('[StalkerClient] Get Main Info (Account)...');
    return this.makeRequest('account_info', {
        action: 'get_main_info'
    });
};

StalkerClient.prototype.getProfile = function() {
	console.log('[StalkerClient] Get profile...');
	return this.makeRequest('stb', {
		action: 'get_profile',
        type: 'stb',
		hd: 1,
        ver: 'ImageDescription: 0.2.18-r14-250',
		num_banks: 2,
		sn: '0000000000000',
		stb_type: 'MAG250',
        image_version: '218',
        video_out: 'hdmi',
        device_id: '',
        device_id2: '',
        signature: '',
        not_valid_token: 0,
        auth_second_step: 0
	});
};

StalkerClient.prototype.getCategories = function() {
	console.log('[StalkerClient] Get categories...');
	return this.makeRequest('itv', {
		action: 'get_genres'
	}).then(function(data) {
		var categories = data.js || [];
		console.log('[StalkerClient] Categories count:', categories.length);
		return categories;
	});
};

StalkerClient.prototype.getChannels = function(genreId) {
	console.log('[StalkerClient] Get channels for genre:', genreId);
	var self = this;
	var allChannels = [];
	var page = 1;
	
	// Limit for "All" category to prevent excessive loading
	var isAllCategory = !genreId || genreId === '*';
	// Reduce max limit to avoid long loading times (sequential requests)
	var maxChannels = isAllCategory ? 500 : 1000;
	var maxPages = isAllCategory ? 5 : 10;
	
	function fetchPage() {
		return self.makeRequest('itv', {
			action: 'get_ordered_list',
			genre: genreId || '*',
			force_ch_link_check: 0,
			fav: 0,
			sortby: 'number',
			hd: 0,
			p: page,
			limit: 100
		}).then(function(data) {
			var channels = (data.js && data.js.data) || [];
			console.log('[StalkerClient] Page ' + page + ' loaded, count:', channels.length);
			
			if (channels.length > 0) {
				allChannels = allChannels.concat(channels);
				
				// Stop if we reached max channels
				if (allChannels.length >= maxChannels) {
					console.log('[StalkerClient] Reached max channels limit:', maxChannels);
					return allChannels.slice(0, maxChannels);
				}
				
				// Check if there are more pages
				var totalItems = (data.js && data.js.total_items) || 0;
				var hasMore = totalItems > allChannels.length;
				
				// Continue if there are more items and we haven't reached max pages
				if (hasMore && page < maxPages) {
					page++;
					return fetchPage();
				}
			}
			return allChannels;
		});
	}
	
	return fetchPage().then(function(channels) {
		console.log('[StalkerClient] Total channels loaded:', channels.length);
		return channels;
	});
};

StalkerClient.prototype.searchChannels = function(query) {
	console.log('[StalkerClient] Search channels for:', query);
	var self = this;
	var allChannels = [];
	var page = 1;
	var maxPages = 10;
	
	function fetchPage() {
		return self.makeRequest('itv', {
			action: 'get_ordered_list',
			genre: '*',
			force_ch_link_check: 0,
			fav: 0,
			sortby: 'name',
			hd: 0,
			p: page,
			limit: 100
		}).then(function(data) {
			var channels = (data.js && data.js.data) || [];
			
			if (channels.length > 0) {
				allChannels = allChannels.concat(channels);
				var totalItems = (data.js && data.js.total_items) || 0;
				var hasMore = totalItems > allChannels.length;
				
				if (hasMore && page < maxPages) {
					page++;
					return fetchPage();
				}
			}
			return allChannels;
		});
	}
	
	return fetchPage().then(function(channels) {
		var queryLower = query.toLowerCase();
		var filtered = channels.filter(function(channel) {
			var name = (channel.name || '').toLowerCase();
			return name.indexOf(queryLower) !== -1;
		});
		return filtered;
	});
};

StalkerClient.prototype.createLink = function(cmd) {
	console.log('[StalkerClient] Create link for cmd:', cmd);
	return this.makeRequest('itv', {
		action: 'create_link',
		cmd: cmd,
		series: 0,
		forced_storage: 0,
		disable_ad: 0,
		download: 0,
		force_ch_link_check: 0
	}).then(function(data) {
		var streamUrl = null;
		if (typeof data === 'string') {
			streamUrl = data;
		} else if (data.js && data.js.cmd) {
			streamUrl = data.js.cmd;
		} else if (data.cmd) {
			streamUrl = data.cmd;
		}
		
		if (streamUrl && streamUrl.startsWith('ffmpeg ')) {
			streamUrl = streamUrl.substring(7);
		}
		
		console.log('[StalkerClient] Stream URL:', streamUrl);
		return streamUrl;
	});
};

StalkerClient.prototype.getVodCategories = function() {
	return this.makeRequest('vod', {
		action: 'get_categories'
	}).then(function(data) {
		return data.js || [];
	});
};

StalkerClient.prototype.getVodItems = function(categoryId, page) {
	console.log('[StalkerClient] Get VOD items for category:', categoryId);
	var self = this;
	var allItems = [];
	var currentPage = page || 1;
	var maxItems = 1000;
	var maxPages = 10;
	
	function fetchPage() {
		return self.makeRequest('vod', {
			action: 'get_ordered_list',
			category: categoryId || '*',
			sortby: 'added',
			p: currentPage,
			limit: 100
		}).then(function(data) {
			var items = (data.js && data.js.data) || [];
			console.log('[StalkerClient] VOD Page ' + currentPage + ' loaded, count:', items.length);
			
			if (items.length > 0) {
				allItems = allItems.concat(items);
				
				if (allItems.length >= maxItems) {
					return { data: allItems.slice(0, maxItems), total_items: data.js.total_items };
				}
				
				var totalItems = (data.js && data.js.total_items) || 0;
				var hasMore = totalItems > allItems.length;
				
				if (hasMore && currentPage < maxPages) {
					currentPage++;
					return fetchPage();
				}
			}
            // Return structure matching original expectation but with all items
			return { data: allItems, total_items: (data.js ? data.js.total_items : allItems.length) };
		});
	}
	
	return fetchPage();
};

StalkerClient.prototype.createVodLink = function(cmd) {
	return this.makeRequest('vod', {
		action: 'create_link',
		cmd: cmd,
		series: 0
	}).then(function(data) {
		var streamUrl = null;
		if (typeof data === 'string') {
			streamUrl = data;
		} else if (data.js && data.js.cmd) {
			streamUrl = data.js.cmd;
		} else if (data.cmd) {
			streamUrl = data.cmd;
		}
		
		if (streamUrl && streamUrl.startsWith('ffmpeg ')) {
			streamUrl = streamUrl.substring(7).trim();
		}
		
		return {
            url: streamUrl,
            js: data.js || data
        };
	});
};

StalkerClient.prototype.getSeriesInfo = function(vodId) {
	return this.makeRequest('vod', {
		action: 'get_ordered_list',
		movie_id: vodId,
		season_id: 0
	}).then(function(data) {
		return data.js || {};
	});
};

StalkerClient.prototype.searchVod = function(query) {
	return this.makeRequest('vod', {
		action: 'get_ordered_list',
		search: query,
		sortby: 'added'
	}).then(function(data) {
		return data.js || {};
    });
};

StalkerClient.prototype.getVodInfo = function(vodId) {
    console.log('[StalkerClient] Get VOD Info for:', vodId);
    return this.makeRequest('vod', {
        action: 'vod_info',
        movie_id: vodId
    }).then(function(data) {
        return data.js || {};
    });
};

StalkerClient.prototype.logout = function() {
	// Attempt to notify server (optional, best effort)
	console.log('[StalkerClient] Logging out...');
    
    // Clear token locally
    this.token = null;
    
    // Some portals support an 'logout' or 'exit' action, but it's inconsistent.
    // We mainly want to clear our session state.
	return Promise.resolve(true); 
};


// Get or create client
function getClient(baseUrl, mac) {
	var key = mac;
	if (!clients[key]) {
		console.log('[Service] Creating new client for MAC:', mac);
		clients[key] = new StalkerClient(baseUrl, mac);
	}
	return clients[key];
}

// Stalker Request Handler
service.register("stalkerRequest", function(message) {
	try {
		console.log("[stalkerRequest] ===== START =====");
		console.log("[stalkerRequest] Action:", message.payload.action);
		
		var action = message.payload.action;
		var baseUrl = message.payload.baseUrl;
		var mac = message.payload.mac;
		var params = message.payload.params || {};
		
		if (!baseUrl || !mac) {
			message.respond({
				returnValue: false,
				errorText: "Missing baseUrl or mac"
			});
			return;
		}
		
		var client = getClient(baseUrl, mac);
		var promise;
		
		switch (action) {
			case 'login':
			case 'handshake':
				promise = client.handshake().then(function() {
					return client.getProfile().then(function() { return {success: true}; });
				});
				break;
			case 'categories':
				promise = client.getCategories();
				break;
			case 'channels':
				promise = client.getChannels(params.genreId);
				break;
			case 'link':
				promise = client.createLink(params.cmd);
				break;
			case 'search':
				promise = client.searchChannels(params.query);
				break;
			case 'vod_categories':
				promise = client.getVodCategories();
				break;
			case 'vod_items':
				promise = client.getVodItems(params.categoryId, params.page);
				break;
			case 'vod_link':
				promise = client.createVodLink(params.cmd);
				break;
			case 'series_info':
				promise = client.getSeriesInfo(params.vodId);
				break;
            case 'vod_info':
                promise = client.getVodInfo(params.vodId);
                break;
			case 'vod_search':
				promise = client.searchVod(params.query);
				break;
            case 'logout':
                promise = client.logout().then(function() {
                    // Remove from active clients
                    if (clients[mac]) {
                        delete clients[mac];
                        console.log('[Service] Removed client session for MAC:', mac);
                    }
                    return { success: true };
                });
                break;
			default:
				message.respond({
					returnValue: false,
					errorText: "Invalid action: " + action
				});
				return;
		}
		
		promise
			.then(function(result) {
				message.respond({
					returnValue: true,
					data: result
				});
			})
			.catch(function(error) {
				console.error("[stalkerRequest] Error:", error);
				message.respond({
					returnValue: false,
					errorText: error.message || 'Unknown error'
				});
			});
	} catch (error) {
		console.error("[stalkerRequest] Exception:", error);
		message.respond({
			returnValue: false,
			errorText: "Service exception: " + error.message
		});
	}
});

// Stream Proxy
var proxyServer = null;
var proxyPort = 8080;
var currentStreamUrl = null;
var currentClient = null;

// ADDED: Helper function to detect content type for LG TV
// Improved Content-Type detection for WebOS
function detectContentType(url, originalType) {
    if (!url) return 'video/mp4';
    var urlLower = url.toLowerCase();
    
    // Jika VOD MKV
    if (urlLower.indexOf('.mkv') !== -1 || urlLower.indexOf('type=movie') !== -1) {
        return 'video/x-matroska';
    }
    // Jika Live TV TS
    if (urlLower.indexOf('.ts') !== -1 || urlLower.indexOf('live.php') !== -1 || urlLower.indexOf('extension=ts') !== -1) {
        return 'video/mp2t';
    }
    
    // Use original if available and not generic
    if (originalType && originalType !== 'application/octet-stream') {
        return originalType;
    }
    
    // Fallback based on extension
    if (urlLower.indexOf('.mp4') !== -1) return 'video/mp4';
    if (urlLower.indexOf('.avi') !== -1) return 'video/x-msvideo';
    if (urlLower.indexOf('.m3u8') !== -1) return 'application/vnd.apple.mpegurl';
    
    return 'video/mp4';
}

function initProxyServer() {
	if (proxyServer) return;
	
	try {
        // TIMEOUT CONFIGURATION (SOLUSI 3)
        var STREAM_TIMEOUT = 120000; // 2 minutes for live streams
        
        // HTTP Agents with Keep-Alive
        var httpAgent = new http.Agent({ 
            keepAlive: true, 
            maxSockets: 50,
            timeout: STREAM_TIMEOUT
        });

        var httpsAgent = new https.Agent({ 
            keepAlive: true, 
            maxSockets: 50,
            timeout: STREAM_TIMEOUT,
            rejectUnauthorized: false
        });

        // Helper function to handle proxy requests with redirect support
        function doProxyRequest(targetUrl, req, res, redirectCount, extraCookies) {
             if (redirectCount > 5) {
                 if (!res.headersSent) {
                     res.writeHead(502, {'Content-Type': 'text/plain'});
                     res.end('Too many redirects');
                 }
                 return;
             }
             
            // Request Proxy
			var isHttps = targetUrl.startsWith('https://');
			var lib = isHttps ? https : http;
			var urlWithoutProtocol = targetUrl.replace(/^https?:\/\//, '');
			var pathStartIndex = urlWithoutProtocol.indexOf('/');
			var hostPort = pathStartIndex === -1 ? urlWithoutProtocol : urlWithoutProtocol.substring(0, pathStartIndex);
			var path = pathStartIndex === -1 ? '/' : urlWithoutProtocol.substring(pathStartIndex);
			var portIndex = hostPort.indexOf(':');
			var hostname = portIndex === -1 ? hostPort : hostPort.substring(0, portIndex);
			var port = portIndex === -1 ? (isHttps ? 443 : 80) : parseInt(hostPort.substring(portIndex + 1));
            
            console.log('[StreamProxy] Requesting:', targetUrl);

            var requestHeaders = {};
            // Forward ALL headers from client first
            for (var h in req.headers) {
                if (h.toLowerCase() !== 'host') {
                    requestHeaders[h] = req.headers[h];
                }
            }

            // DETECT REQUEST TYPE
            // User requested: include movie.php in stream detection
            var isStreamRequest = targetUrl.includes('live.php') || targetUrl.includes('movie.php') || targetUrl.includes('extension=ts');
            
            // isApiRequest logic not needed if using else
            
            if (isStreamRequest) {
                console.log('[StreamProxy] Mode: Streaming - Maintaining MAG250 Identity');
                
                // KUNCI: Gunakan UA yang sama dengan handshake
                requestHeaders['User-Agent'] = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
                requestHeaders['X-User-Agent'] = 'Model: MAG250; Link: WiFi';
                
                // KUNCI: Teruskan Cookie dan Token dari client aktif
                if (currentClient) {
                    if (currentClient.cookies) {
                        var cookieStr = Array.isArray(currentClient.cookies) ? currentClient.cookies.join('; ') : currentClient.cookies;
                        if (extraCookies && extraCookies.length > 0) {
                            cookieStr += (cookieStr ? '; ' : '') + extraCookies.join('; ');
                        }
                        requestHeaders['Cookie'] = cookieStr;
                    }
                    if (currentClient.token) requestHeaders['Authorization'] = 'Bearer ' + currentClient.token;
                    
                    // Teruskan Referer (Sangat penting untuk portal go4k)
                    // Teruskan Referer (Sangat penting untuk portal go4k)
                    var refererUrl = currentClient.baseUrl;
                    if (refererUrl) {
                        // Normalize to end with /c/index.html
                        if (!refererUrl.endsWith('/')) refererUrl += '/';
                        if (refererUrl.endsWith('/c/')) refererUrl += 'index.html';
                        else if (!refererUrl.includes('index.html')) refererUrl += 'c/index.html';
                        
                        requestHeaders['Referer'] = refererUrl;
                    }
                }

                // Pastikan Connection tetap terbuka
                requestHeaders['Connection'] = 'keep-alive';
                requestHeaders['Icy-MetaData'] = '1';

                // Teruskan Range header jika ada (Penting untuk VOD agar tidak Format Error)
                if (req.headers['range']) {
                    requestHeaders['Range'] = req.headers['range'];
                } else {
                     // Default range for streams if missing
                     requestHeaders['Range'] = 'bytes=0-';
                }
            } else {
                // API/PORTAL CONFIGURATION (Matches STB behavior)
                console.log('[StreamProxy] Mode: API - STB Identity');
                requestHeaders['User-Agent'] = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
                requestHeaders['X-User-Agent'] = 'Model: MAG250; Link: WiFi';
                
                // Merge Cookies
                var cookiesToSend = (currentClient && currentClient.cookies) ? currentClient.cookies.slice() : [];
                if (extraCookies && extraCookies.length > 0) {
                    cookiesToSend = cookiesToSend.concat(extraCookies);
                }
                requestHeaders['Cookie'] = cookiesToSend.join('; ');

                // Referer logic
                // Referer logic - FIXED to avoid double /c/
                var refererUrl = (currentClient && currentClient.baseUrl) ? currentClient.baseUrl : '';
                if (refererUrl && !refererUrl.includes('index.html')) {
                    // Normalize slash
                    if (!refererUrl.endsWith('/')) refererUrl += '/';
                    
                    // Check if it already has 'c/'
                    if (refererUrl.endsWith('/c/')) {
                        refererUrl += 'index.html';
                    } else {
                        refererUrl += 'c/index.html';
                    }
                }
                requestHeaders['Referer'] = refererUrl;
                
                // Authorization Token
                if (currentClient && currentClient.token) {
                   requestHeaders['Authorization'] = 'Bearer ' + currentClient.token;
                }
                
                requestHeaders['Connection'] = 'keep-alive';
            }
            
            // Common cleanup
            delete requestHeaders['host']; 
            
            var upstreamReq = lib.request({
                hostname: hostname,
                port: port,
                path: path,
                method: req.method === 'HEAD' ? 'HEAD' : 'GET',
                headers: requestHeaders,
                timeout: STREAM_TIMEOUT, 
                agent: isHttps ? httpsAgent : httpAgent,
                rejectUnauthorized: false
            }, function(upstreamRes) {
				// Handle redirects INTERNALLY (FIXED: added 303)
				if (upstreamRes.statusCode === 302 || upstreamRes.statusCode === 301 || upstreamRes.statusCode === 303 || upstreamRes.statusCode === 307) {
					var redirectUrl = upstreamRes.headers['location'];
					if (redirectUrl) {
                        console.log('[StreamProxy] Following redirect (' + (redirectCount + 1) + ') to:', redirectUrl);
                        upstreamRes.resume(); // Discard body
                        
                        // Handle relative redirects
                        if (!redirectUrl.startsWith('http')) {
                            var protocol = isHttps ? 'https://' : 'http://';
                            redirectUrl = protocol + hostname + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
                        }
                        
                        // Capture Set-Cookie for next request
                        var nextCookies = (extraCookies || []).slice();
                        var newCookies = upstreamRes.headers['set-cookie'];
                        if (newCookies) {
                            newCookies.forEach(function(c) {
                                // Extract name=value part (before first semicolon)
                                var parts = c.split(';');
                                if (parts.length > 0) nextCookies.push(parts[0].trim());
                            });
                            console.log('[StreamProxy] Captured ' + newCookies.length + ' new cookies from redirect');
                        }
                        
						doProxyRequest(redirectUrl, req, res, redirectCount + 1, nextCookies);
						return; 
					}
				}
                
                if (upstreamRes.statusCode !== 200 && upstreamRes.statusCode !== 206) {
                    console.error('[StreamProxy] Bad Upstream Status:', upstreamRes.statusCode);
                }
				
                // Event Handling for Debugging (SOLUSI 1)
                upstreamRes.on('aborted', function() { console.error('[StreamProxy] Upstream connection aborted'); });
                upstreamRes.on('close', function() { console.log('[StreamProxy] Upstream connection closed'); });
                
				var responseHeaders = {};
                
                // Hop-by-hop headers that should NOT be forwarded
                var hopByHopHeaders = [
                    'connection',
                    'keep-alive',
                    'proxy-authenticate',
                    'proxy-authorization',
                    'te',
                    'trailer',
                    'transfer-encoding',
                    'upgrade',
                    'host',
                    'content-length' // FIXED: Strip Content-Length for proxying to allow chunked/streamed
                ];
                
                // Forward uppercase/lowercase compatible headers
                for (var h in upstreamRes.headers) {
                    if (hopByHopHeaders.indexOf(h.toLowerCase()) === -1) {
                        responseHeaders[h] = upstreamRes.headers[h];
                    }
                }
                
                // FIXED: Better Content-Type detection for LG TV
                var originalContentType = responseHeaders['content-type'] || '';
                console.log('[StreamProxy] Original Content-Type:', originalContentType);
                
                var detectedType = detectContentType(currentStreamUrl, originalContentType);
                if (detectedType) {
                    console.log('[StreamProxy] Setting Content-Type to:', detectedType);
                    responseHeaders['content-type'] = detectedType;
                }
                
                // FIXED: Complete CORS headers
				responseHeaders['Access-Control-Allow-Origin'] = '*';
                responseHeaders['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
                responseHeaders['Access-Control-Allow-Headers'] = 'Range, Content-Type';
                responseHeaders['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Content-Type';
                
                // FIXED: Ensure Accept-Ranges is forwarded for seeking support
                if (upstreamRes.headers['accept-ranges']) {
                    responseHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges'];
                }
                
                console.log('[StreamProxy] Upstream Response:', upstreamRes.statusCode, 'Headers:', JSON.stringify(responseHeaders));
				
				res.writeHead(upstreamRes.statusCode, responseHeaders);
				upstreamRes.pipe(res);
                
                let bytesTransferred = 0;
                upstreamRes.on('data', (chunk) => { bytesTransferred += chunk.length; });
                upstreamRes.on('end', () => console.log('[StreamProxy] Upstream ended. Total Bytes:', bytesTransferred));
                upstreamRes.on('close', () => console.log('[StreamProxy] Upstream closed.'));
                
                res.on('close', () => {
                     console.log('[StreamProxy] Client (TV) closed connection. Bytes sent:', bytesTransferred);
                     upstreamReq.destroy(); // Ensure upstream is killed
                });
			});
			
			upstreamReq.on('error', function(err) {
				console.error('[StreamProxy] Upstream Request Error:', err);
				if (!res.headersSent) {
					res.writeHead(502);
					res.end('Proxy Error: ' + err.message);
				}
			});
			
			upstreamReq.on('timeout', function() {
                console.error('[StreamProxy] Upstream Timeout');
				upstreamReq.destroy();
				if (!res.headersSent) {
					res.writeHead(504);
					res.end('Proxy Timeout');
				}
			});
			
			upstreamReq.end();
        }

		proxyServer = http.createServer(function(req, res) {
			// CORS
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
			res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Icy-MetaData');
			
			if (req.method === 'OPTIONS') {
				res.writeHead(200);
				res.end();
				return;
			}

			if (!currentStreamUrl || !currentClient) {
				res.writeHead(500, {'Content-Type': 'text/plain'});
				res.end('No active stream');
				return;
			}
			
            doProxyRequest(currentStreamUrl, req, res, 0, []);
		});
		
		proxyServer.listen(proxyPort, function() {
			console.log('[StreamProxy] Proxy server listening on port', proxyPort);
		});
	} catch (e) {
		console.error('Failed to init proxy:', e);
	}
}

initProxyServer();

service.register("streamProxy", function(message) {
    var url = message.payload.url;
    var baseUrl = message.payload.baseUrl;
    var mac = message.payload.mac;
    
    if (url && baseUrl && mac) {
        currentStreamUrl = url;
        currentClient = getClient(baseUrl, mac);
        message.respond({
            returnValue: true,
            proxyUrl: "http://localhost:" + proxyPort + "/stream"
        });
    } else {
        var missing = [];
        if (!url) missing.push('url');
        if (!baseUrl) missing.push('baseUrl');
        if (!mac) missing.push('mac');
        
        console.error('[streamProxy] Missing params:', missing.join(', '), 'Payload:', JSON.stringify(message.payload));
        
        message.respond({
            returnValue: false,
            errorText: "Missing params: " + missing.join(', ')
        });
    }
});



service.register("heartbeat", function(message) {
    message.respond({
        returnValue: true,
        event: "beat"
    });
});