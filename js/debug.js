class Debugger {
    constructor() {
        this.overlay = document.getElementById('debug-overlay');
        this.content = document.getElementById('debug-content');
        this.isVisible = true;
        this.overlay.classList.remove('hidden');
        this.maxLines = 100;
        
        this.setupKeyboard();
        this.log('Debug system initialized');
    }

    setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            // Toggle with red button (403) long press or a specific key combo if needed
            // For now let's map it to '0' key for standard remotes if not used, 
            // or maybe just a specific key.
            // Let's use '0' for toggle.
            if (e.key === '0') {
                this.toggle();
            }
        });
    }

    toggle() {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.overlay.classList.remove('hidden');
        } else {
            this.overlay.classList.add('hidden');
        }
    }

    log(msg, type = 'info') {
        if (!this.content) return;

        const line = document.createElement('div');
        line.className = `debug-line ${type}`;
        
        const time = new Date().toLocaleTimeString().split(' ')[0];
        line.textContent = `[${time}] ${msg}`;
        
        this.content.appendChild(line);
        
        // Auto scroll
        this.content.scrollTop = this.content.scrollHeight;
        
        // Prune old logs
        while (this.content.children.length > this.maxLines) {
            this.content.removeChild(this.content.firstChild);
        }
    }

    error(msg) { this.log(msg, 'error'); }
    warn(msg) { this.log(msg, 'warn'); }
    info(msg) { this.log(msg, 'info'); }
}

// Override console methods to capture logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

window.debug = new Debugger();

console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    // Convert args to string
    const msg = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    
    if (window.debug) window.debug.log(msg, 'info');
};

console.error = function(...args) {
    originalConsoleError.apply(console, args);
    const msg = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    
    if (window.debug) window.debug.error(msg);
};

console.warn = function(...args) {
    originalConsoleWarn.apply(console, args);
    const msg = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch(e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');
    
    if (window.debug) window.debug.warn(msg);
};
