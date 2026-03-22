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

// --- KONFIGURASI AGENT UNTUK BYPASS FIREWALL ---
// Menggunakan keepAlive: true sangat penting untuk meniru browser/STB
var httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
    keepAliveMsecs: 3000
});

var httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    keepAliveMsecs: 3000,
    rejectUnauthorized: false, // Abaikan error SSL self-signed
    minVersion: 'TLSv1',
    checkServerIdentity: function (host, cert) { return undefined; } // Bypass hostname check
});

var service = new Service(pkgInfo.name);
var STALKER_TIMEOUT = 30000;

console.log('[Service] ===== SERVICE STARTING (STEALTH MODE) =====');

// Error Handling Global
process.on('uncaughtException', function (err) {
    console.error('[Service] UNCAUGHT:', err.message);
});
process.on('unhandledRejection', function (reason, p) {
    console.error('[Service] REJECTION:', reason);
});

var clients = {};

// --- CLASS STALKER CLIENT (MODIFIED) ---
function StalkerClient(baseUrl, mac) {
    this.baseUrl = baseUrl;
    // Pastikan URL diakhiri slash
    if (!this.baseUrl.endsWith('/')) this.baseUrl += '/';

    this.mac = mac;
    this.token = null;

    // SETUP COOKIE AWAL STANDAR MAG
    // Timezone & Lang sangat penting agar tidak terdeteksi sebagai bot
    this.cookies = [
        'mac=' + encodeURIComponent(mac),
        'stb_lang=en',
        'timezone=Europe%2FParis', // Gunakan URL Encoded timezone
        'display_menu_after_loading=true'
    ];

    // Generate Serial & Device ID dari MAC (Format standar emulator)
    var cleanMac = mac.replace(/:/g, '').toUpperCase();
    this.serialNumber = cleanMac;
    this.deviceId = cleanMac;
    this.deviceId2 = cleanMac;

    console.log('[StalkerClient] Init:', baseUrl, mac);
}

StalkerClient.prototype.makeRequest = function (action, params, method) {
    var self = this;
    var reqMethod = method || 'GET';

    // Portal Stalker biasanya ada di /c/ atau /portal.php
    // Kita coba path standar stalker middleware
    var endpoints = [
        'server/load.php',       // Default modern
        'portal.php',            // Default lama
        'stalker_portal/server/load.php'
    ];

    // Helper untuk mencari endpoint yang benar
    function tryEndpoint(idx) {
        if (idx >= endpoints.length) {
            return Promise.reject(new Error('All endpoints failed. Server might be down or incompatible.'));
        }

        var endpoint = endpoints[idx];
        var apiUrl = self.baseUrl + endpoint;

        // Cek jika baseUrl sudah mengandung /c/
        if (!self.baseUrl.includes('/c/') && !self.baseUrl.includes('portal.php')) {
            apiUrl = self.baseUrl + 'c/' + endpoint;
        }

        return new Promise(function (resolve, reject) {

            // Build Parameters
            var queryParams = [];
            // Parameter wajib 'type' harus di awal
            queryParams.push('type=' + encodeURIComponent(action));

            // Masukkan params lain
            if (params) {
                for (var key in params) {
                    if (params.hasOwnProperty(key)) {
                        queryParams.push(key + '=' + encodeURIComponent(params[key]));
                    }
                }
            }

            // Tambahkan parameter anti-bot jika belum ada
            if (!params.action && action !== 'handshake') {
                queryParams.push('action=' + encodeURIComponent(action));
            }

            var bodyData = queryParams.join('&');
            var fullUrl = apiUrl;

            if (reqMethod === 'GET') {
                fullUrl += '?' + bodyData;
            }

            var urlParts = url.parse(fullUrl);
            var isHttps = urlParts.protocol === 'https:';
            var port = urlParts.port || (isHttps ? 443 : 80);

            // --- HEADER PENYAMARAN (STEALTH HEADERS) ---
            // Using modern browser User-Agent to bypass Cloudflare/server blocks
            var headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-User-Agent': 'Model: MAG250; Link: WiFi',
                'Referer': self.baseUrl + 'c/',
                'Origin': urlParts.protocol + '//' + urlParts.host,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Encoding': 'gzip, deflate',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                'Cookie': self.cookies.join('; '),
                'Host': urlParts.hostname + (urlParts.port && urlParts.port != 80 && urlParts.port != 443 ? ':' + urlParts.port : '')
            };

            // Tambahkan Authorization Bearer jika sudah login
            if (self.token) {
                headers['Authorization'] = 'Bearer ' + self.token;
            }

            if (reqMethod === 'POST') {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(bodyData);
            }

            var options = {
                hostname: urlParts.hostname,
                port: port,
                path: urlParts.path,
                method: reqMethod,
                headers: headers,
                timeout: STALKER_TIMEOUT,
                agent: isHttps ? httpsAgent : httpAgent
            };

            // Hapus header otomatis Node.js yang bisa memicu blokir
            delete options.headers['expect'];

            var req = (isHttps ? https : http).request(options, function (res) {
                var data = '';

                // --- UPDATE COOKIE DARI SERVER ---
                // Server Stalker sering mengirim cookie baru saat handshake
                if (res.headers['set-cookie']) {
                    var newCookies = res.headers['set-cookie'];
                    if (!Array.isArray(newCookies)) newCookies = [newCookies];

                    newCookies.forEach(function (c) {
                        var parts = c.split(';');
                        var kv = parts[0].trim(); // nama=nilai
                        // Cek apakah cookie sudah ada, jika ada update, jika tidak push
                        var key = kv.split('=')[0];
                        var updated = false;
                        for (var i = 0; i < self.cookies.length; i++) {
                            if (self.cookies[i].startsWith(key + '=')) {
                                self.cookies[i] = kv;
                                updated = true;
                                break;
                            }
                        }
                        if (!updated) self.cookies.push(kv);
                    });
                    // console.log('[Cookie] Updated:', self.cookies);
                }

                res.setEncoding('utf8');
                res.on('data', function (chunk) { data += chunk; });

                res.on('end', function () {
                    // --- DETEKSI BLOKIR / HTML ERROR ---
                    if (data.trim().startsWith('<')) {
                        console.error('[StalkerClient] HTML Response detected (Error/Block):', data.substring(0, 150));

                        if (data.indexOf('BANNED') !== -1 || data.indexOf('YOU ARE BA') !== -1) {
                            reject(new Error('PORTAL_BLOCK: Server firewall memblokir request ini (Anti-Bot).'));
                        } else if (res.statusCode === 404) {
                            // Coba endpoint berikutnya jika 404
                            reject(new Error('404 Not Found'));
                        } else {
                            // Terkadang server mengirim HTML error page standar
                            reject(new Error('Server Error (HTML Response): ' + res.statusCode));
                        }
                        return;
                    }

                    if (res.statusCode >= 400) {
                        reject(new Error('HTTP ' + res.statusCode));
                        return;
                    }

                    try {
                        if (!data) throw new Error('Empty response');
                        var json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        console.error('JSON Parse Error. Data:', data);
                        reject(new Error('Invalid JSON from server'));
                    }
                });
            });

            req.on('error', function (e) {
                console.error('[Request Error]', e.message);
                reject(e);
            });

            if (reqMethod === 'POST') req.write(bodyData);
            req.end();
        });
    }

    // Retry logic wrapper
    return tryEndpoint(0).catch(function (err) {
        // Jika endpoint pertama gagal (404/Error), coba endpoint kedua
        if (endpoints.length > 1) {
            console.log('[StalkerClient] Endpoint 1 failed, trying fallback...');
            return tryEndpoint(1);
        }
        throw err;
    });
};

StalkerClient.prototype.handshake = function () {
    var self = this;
    var random = Math.floor(Math.random() * 1000000);

    // --- STRATEGI HANDSHAKE PALING AMAN ---
    // Menggunakan parameter 'stb' standar yang diterima semua versi stalker

    var params = {
        action: 'handshake',
        type: 'stb',
        token: '', // Kosong saat awal
        mac: self.mac,
        random: random,
        // Parameter Identitas Perangkat (Penting untuk Anti-Ban)
        sn: self.serialNumber,
        stb_type: 'MAG250',
        ver: 'ImageDescription: 0.2.18-r14-250',
        image_version: '218',
        auth_second_step: 0,
        hd: 1,
        not_valid_token: 0,
        hw_version: '1.7-BD-00',
        device_id: self.deviceId,
        device_id2: self.deviceId2,
        signature: self.deviceId
    };

    console.log('[Handshake] Sending request to', self.baseUrl);

    return self.makeRequest('stb', params).then(function (data) {
        if (data && data.js && data.js.token) {
            self.token = data.js.token;
            console.log('[Handshake] SUCCESS. Token:', self.token);
            return true;
        } else {
            console.error('[Handshake] Failed. Response:', JSON.stringify(data));
            throw new Error('Handshake failed: No token received');
        }
    });
};

// --- SERVICE METHODS (Sama seperti sebelumnya tapi disederhanakan) ---

// Helper untuk Get Client
function getClient(baseUrl, mac) {
    // Buat key unik
    var key = mac + '@' + baseUrl;
    if (!clients[key]) {
        clients[key] = new StalkerClient(baseUrl, mac);
    }
    return clients[key];
}

// --- CLASS XTREAM CLIENT (STEALTH MODE) ---
function XtreamClient(baseUrl, username, password) {
    this.baseUrl = baseUrl;
    if (!this.baseUrl.endsWith('/')) this.baseUrl += '/';

    this.username = username;
    this.password = password;
    this.token = null; // Some generic panels use tokens, but usually user/pass

    console.log('[XtreamClient] Init:', baseUrl, username);
}

XtreamClient.prototype.makeRequest = function (action, params) {
    var self = this;

    // Construct Xtream API URL (player_api.php)
    var apiUrl = self.baseUrl + 'player_api.php';

    return new Promise(function (resolve, reject) {
        var queryParams = [];
        queryParams.push('username=' + encodeURIComponent(self.username));
        queryParams.push('password=' + encodeURIComponent(self.password));

        if (action) {
            queryParams.push('action=' + encodeURIComponent(action));
        }

        if (params) {
            for (var key in params) {
                if (params.hasOwnProperty(key)) {
                    queryParams.push(key + '=' + encodeURIComponent(params[key]));
                }
            }
        }

        var fullUrl = apiUrl + '?' + queryParams.join('&');
        var urlParts = url.parse(fullUrl);
        var isHttps = urlParts.protocol === 'https:';
        var port = urlParts.port || (isHttps ? 443 : 80);

        // STEALTH HEADERS FOR XTREAM (Mimic IPTVSmarters)
        var headers = {
            'User-Agent': 'IPTVSmartersPro', // Standard Valid UA for Xtream
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Connection': 'Keep-Alive',
            'Host': urlParts.hostname
        };

        var options = {
            hostname: urlParts.hostname,
            port: port,
            path: urlParts.path,
            method: 'GET',
            headers: headers,
            timeout: STALKER_TIMEOUT,
            agent: isHttps ? httpsAgent : httpAgent
        };

        delete options.headers['expect'];

        var req = (isHttps ? https : http).request(options, function (res) {
            var data = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                if (res.statusCode >= 400) {
                    reject(new Error('HTTP Error ' + res.statusCode));
                    return;
                }
                try {
                    if (!data) throw new Error('Empty response');
                    var json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    // Start of standard Xtream might be empty or raw text
                    console.error('[Xtream] JSON Parse Error. Data:', data.substring(0, 100));
                    reject(new Error('Invalid JSON from Xtream server'));
                }
            });
        });

        req.on('error', function (e) {
            console.error('[Xtream] Request Error:', e.message);
            reject(e);
        });

        req.end();
    });
};

XtreamClient.prototype.login = function () {
    // Xtream login is just a request without action (returns user_info)
    return this.makeRequest(null, {});
};

// Helper for Get Xtream Client
function getXtreamClient(baseUrl, username, password) {
    var key = 'xtream|' + baseUrl + '|' + username;
    if (!clients[key]) {
        clients[key] = new XtreamClient(baseUrl, username, password);
    }
    return clients[key];
}


service.register("stalkerRequest", function (message) {
    var payload = message.payload;
    var action = payload.action;
    var baseUrl = payload.baseUrl;
    var mac = payload.mac;
    var params = payload.params || {};

    if (!baseUrl || !mac) {
        message.respond({ returnValue: false, errorText: "Missing params" });
        return;
    }

    var client = getClient(baseUrl, mac);
    var promise;

    if (action === 'handshake') {
        promise = client.handshake();
    } else {
        // Generic request wrapper
        // Mapping 'categories', 'channels', 'link' ke API Stalker
        if (action === 'categories') {
            promise = client.makeRequest('itv', { action: 'get_genres' }).then(d => d.js || []);
        }
        else if (action === 'channels') {
            promise = client.makeRequest('itv', {
                action: 'get_ordered_list',
                genre: params.genreId || '*',
                force_ch_link_check: 0,
                fav: 0,
                sortby: 'number',
                hd: 0,
                p: params.p || 1 // Support pagination
            }).then(d => (d.js && d.js.data) ? d.js.data : []);
        }
        else if (action === 'search') {
            // Stalker Search (Global or Category)
            promise = client.makeRequest('itv', {
                action: 'get_ordered_list',
                type: 'itv',
                namelike: params.query,
                force_ch_link_check: 0,
                fav: 0,
                p: 1 // Search results usually page 1
            }).then(d => (d.js && d.js.data) ? d.js.data : []);
        }
        else if (action === 'link') {
            promise = client.makeRequest('itv', {
                action: 'create_link',
                cmd: params.cmd,
                force_ch_link_check: 0
            }).then(d => {
                var url = (d.js && d.js.cmd) ? d.js.cmd : d.cmd;
                if (url) url = url.replace('ffmpeg ', '');
                return url;
            });
        }
        // VOD Methods
        else if (action === 'vod_categories') {
            promise = client.makeRequest('vod', { action: 'get_categories' }).then(d => d.js || []);
        }
        else if (action === 'vod_items') {
            promise = client.makeRequest('vod', {
                action: 'get_ordered_list',
                category: params.categoryId || '*',
                sortby: 'added',
                p: params.page || 1
            }).then(d => {
                // Return full structure with data for frontend compatibility
                return { data: (d.js && d.js.data) ? d.js.data : [] };
            });
        }
        else if (action === 'vod_link') {
            promise = client.makeRequest('vod', {
                action: 'create_link',
                cmd: params.cmd
            }).then(d => {
                var url = (d.js && d.js.cmd) ? d.js.cmd : '';
                if (url) url = url.replace('ffmpeg ', '');
                return { url: url, js: d.js || {} };
            });
        }
        else if (action === 'series_info') {
            promise = client.makeRequest('vod', {
                action: 'get_ordered_list',
                movie_id: params.vodId,
                season_id: 0,
                episode_id: 0
            }).then(d => d.js || {});
        }
        else if (action === 'vod_search') {
            promise = client.makeRequest('vod', {
                action: 'get_ordered_list',
                search: params.query,
                p: 1
            }).then(d => {
                return { data: (d.js && d.js.data) ? d.js.data : [] };
            });
        }
        // getUserInfo
        else if (action === 'getUserInfo') {
            promise = client.makeRequest('stb', {
                action: 'get_profile',
                type: 'stb',
                hd: 1
            }).then(d => {
                return { info: d.js || {} };
            });
        }
        // Default fallback untuk Profile dll
        else if (action === 'get_profile') {
            promise = client.makeRequest('stb', {
                action: 'get_profile', type: 'stb', hd: 1,
                stb_type: 'MAG250', sn: client.serialNumber
            });
        }
        else {
            // Direct pass-through untuk method lain
            promise = client.makeRequest(params.type || 'stb', params);
        }
    }

    promise.then(function (result) {
        message.respond({ returnValue: true, data: result });
    }).catch(function (err) {
        message.respond({ returnValue: false, errorText: err.message });
    });
});

service.register("xtreamRequest", function (message) {
    var payload = message.payload;
    var action = payload.action;
    var baseUrl = payload.baseUrl;
    var username = payload.username;
    var password = payload.password;
    var params = payload.params || {};

    if (!baseUrl || !username || !password) {
        message.respond({ returnValue: false, errorText: "Missing Xtream params (url, user, pass)" });
        return;
    }

    var client = getXtreamClient(baseUrl, username, password);
    var promise;

    if (action === 'login') {
        promise = client.login();
    }
    // MAPPING: Generic Frontend Actions -> Xtream API Actions
    else if (action === 'categories' || action === 'get_live_categories') {
        promise = client.makeRequest('get_live_categories');
    }
    else if (action === 'channels' || action === 'get_live_streams') {
        var streamParams = {};
        if (params.categoryId && params.categoryId !== '*') {
            streamParams.category_id = params.categoryId;
        }
        promise = client.makeRequest('get_live_streams', streamParams);
    }
    else if (action === 'vod_categories' || action === 'get_vod_categories') {
        promise = client.makeRequest('get_vod_categories');
    }
    else if (action === 'vod_items' || action === 'get_vod_streams') {
        promise = client.makeRequest('get_vod_streams', { category_id: params.categoryId });
    }
    else if (action === 'series_categories' || action === 'get_series_categories') {
        promise = client.makeRequest('get_series_categories');
    }
    else if (action === 'series' || action === 'get_series') {
        promise = client.makeRequest('get_series', { category_id: params.categoryId });
    }
    else if (action === 'get_short_epg') {
        promise = client.makeRequest('get_short_epg', { stream_id: params.streamId, limit: params.limit || 10 });
    }
    else if (action === 'link') {
        // Xtream doesn't need a link request usually, we construct it client side or use stream_id
        // But if needed for some reason:
        promise = Promise.resolve({ url: client.baseUrl + 'live/' + client.username + '/' + client.password + '/' + params.streamId + '.ts' });
    }
    else {
        // Direct passthrough
        promise = client.makeRequest(action, params);
    }

    promise.then(function (result) {
        message.respond({ returnValue: true, data: result });
    }).catch(function (err) {
        message.respond({ returnValue: false, errorText: err.message });
    });
});

// --- STREAM PROXY SEDERHANA (Pass-Through) ---
// Kita sederhanakan proxy agar tidak memicu blokir saat streaming
var proxyServer = null;
var currentStreamUrl = null;
var currentClient = null;

function initProxy() {
    proxyServer = http.createServer(function (req, res) {
        if (!currentStreamUrl) {
            res.writeHead(404);
            res.end();
            return;
        }

        var u = url.parse(currentStreamUrl);
        var options = {
            hostname: u.hostname,
            port: u.port || 80,
            path: u.path,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': currentClient ? currentClient.cookies.join('; ') : '',
                'Connection': 'keep-alive',
                'Accept': '*/*'
            }
        };

        var proxyReq = http.request(options, function (proxyRes) {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', function (err) {
            console.error('Proxy Error:', err);
            res.end();
        });

        proxyReq.end();
    });
    proxyServer.listen(8080);
}
initProxy();

service.register("streamProxy", function (message) {
    currentStreamUrl = message.payload.url;
    // Cari client yang aktif untuk ambil cookie-nya
    var key = message.payload.mac + '@' + message.payload.baseUrl;
    currentClient = clients[key];

    message.respond({
        returnValue: true,
        proxyUrl: "http://localhost:8080/stream.ts"
    });
});

service.register("heartbeat", function (message) {
    message.respond({ returnValue: true });
});