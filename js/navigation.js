// Navigation System using js-spatial-navigation
class Navigation {
  constructor() {
    this.setupSpatialNavigation();
    this.setupKeyboardListeners();
  }

  setupSpatialNavigation() {
    // Initialize the library
    SpatialNavigation.init();

    // Define the main section for focusable elements
    SpatialNavigation.add({
      selector: '[data-focusable="true"]',
      rememberSource: true,
      straightOnly: false, // Allow diagonal movement for better grid navigation
      straightOverlapThreshold: 0.5, // More lenient overlap detection
      enterTo: 'last-focused'
    });

    // Make elements focusable (add tabindex if missing)
    SpatialNavigation.makeFocusable();
    
    // Set initial focus if none exists
    if (!document.activeElement || document.activeElement === document.body) {
        SpatialNavigation.focus();
    }

    // Smooth Scrolling Handler
    window.addEventListener('sn:focused', (e) => {
        const el = e.target;
        if (el && el.scrollIntoView) {
            // Use auto (instant) scrolling for better performance on TV
            el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        }
        this.debugLog(`Focused: ${el.tagName}.${el.className}`);
    });
    
    // Debug events
    window.addEventListener('sn:navigatefailed', (e) => {
        this.debugLog(`Nav Failed: ${e.detail.direction}`);
    });
  }

  updateFocusableElements() {
    // Refresh focusable state for dynamic content
    SpatialNavigation.makeFocusable();
    
    // If nothing is focused, try to focus something
    if (!document.activeElement || document.activeElement === document.body) {
         SpatialNavigation.focus();
    }
  }

  setupKeyboardListeners() {
    this.debugLog('Navigation initialized (Spatial)');
    
    document.addEventListener('keydown', (e) => {
      this.handleKeyPress(e);
    });
    
    // Listen for Spatial Navigation failure/success if needed
    // window.addEventListener('sn:navigatefailed', (e) => console.log('Nav failed', e.detail));
  }

  debugLog(msg) {
      console.log(msg);
      // Debug Console logic
      // Debug Console logic - DISABLED per user request
      /*
      const consoleEl = document.getElementById('debug-console');
      if (consoleEl) {
          consoleEl.style.display = 'block'; 
          const line = document.createElement('div');
          line.textContent = `[NAV] ${msg}`;
          consoleEl.appendChild(line);
          consoleEl.scrollTop = consoleEl.scrollHeight;
      }
      */
  }

  handleKeyPress(e) {
    const key = e.keyCode;
    this.debugLog('Key: ' + key);

    // Reset overlay timer on any key press
    if (window.app && window.app.isOverlayMode) {
      window.app.resetOverlayTimer();
    }
    
    // Check if we're in player screen for special handling
    const isPlayerScreen = window.app && window.app.currentScreen === 'player';
    
    // VOD Handling - Intercept keys before anything else
    if (isPlayerScreen && window.app.isVodContent) {
        switch(key) {
            case 37: // Left
                e.preventDefault(); e.stopPropagation();
                window.app.handleVodKey('Left');
                return;
            case 39: // Right
                e.preventDefault(); e.stopPropagation();
                window.app.handleVodKey('Right');
                return;
            case 13: // Enter
                e.preventDefault(); e.stopPropagation();
                window.app.handleVodKey('Enter');
                return;
            case 404: // Green - Play/Pause Alternative
            case 415: // Play
            case 19: // Pause
                e.preventDefault(); e.stopPropagation();
                window.app.handleVodKey('OK'); // Map to Play/Pause toggle
                return;
            case 412: // Rewind (Media Key)
                e.preventDefault(); e.stopPropagation();
                window.app.handleVodKey('Left');
                return;
            case 417: // Fast Fwd (Media Key)
                 e.preventDefault(); e.stopPropagation();
                 window.app.handleVodKey('Right');
                 return;
             case 8: // Back
             case 461: // WebOS Back
             case 27: // Esc
                 e.preventDefault(); e.stopPropagation();
                 window.app.handleVodKey('Back');
                 return;
        }
    }
    
    switch(key) {
      case 37: // Left
        if (isPlayerScreen) {
          e.preventDefault();
          e.stopPropagation();
          window.app.volumeDown();
        }
        // Don't prevent default - let Spatial Navigation handle it
        break;
      case 33: // Page Up
        if (isPlayerScreen) {
          e.preventDefault();
          e.stopPropagation();
          window.app.previousChannel();
        }
        break;
      case 39: // Right
         if (isPlayerScreen) {
           e.preventDefault();
           e.stopPropagation();
           window.app.volumeUp();
         }
         // Don't prevent default - let Spatial Navigation handle it
         break;
      case 34: // Page Down
        if (isPlayerScreen) {
          e.preventDefault();
          e.stopPropagation();
          window.app.nextChannel();
        }
        break;
      case 38: // Up
        // Let Spatial Navigation handle it
        break;
      case 40: // Down
        // Let Spatial Navigation handle it
        break;
      case 13: // OK/Enter
        if (isPlayerScreen) {
          e.preventDefault();
          e.stopPropagation();
          window.app.handlePlayerOK();
        } else {
            // ACTION for non-player screens
            const focused = document.activeElement;
            
            // Allow default behavior for Inputs (Search, Login, etc)
            if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
                 return; 
            }

            if (focused && focused !== document.body) {
                this.debugLog('Enter pressed on: ' + focused.tagName + '.' + focused.className);
                e.preventDefault();
                e.stopPropagation();
                
                let handled = false;

                // Try App handler (Main Screen)
                if (window.app && typeof window.app.handleEnter === 'function') {
                    handled = window.app.handleEnter(focused);
                }
                
                // Try HomeScreen handler (Portal Screen)
                if (!handled && window.homeScreen && typeof window.homeScreen.handleEnter === 'function') {
                    handled = window.homeScreen.handleEnter(focused);
                }

                if (handled) {
                    this.debugLog('Action handled by controller');
                    return;
                }

                // Fallback: dispatch click
                this.debugLog('Fallback: dispatching click');
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                focused.dispatchEvent(clickEvent);
            } else {
                this.debugLog('No element focused!');
                e.preventDefault();
                // Try to focus something
                SpatialNavigation.focus();
            }
        }
        break;
      case 8: // Backspace
      case 461: // WebOS Back
      case 27: // Escape
        // Allow backspace to work in input fields
        const activeEl = document.activeElement;
        const isInputField = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        
        // Only prevent default and trigger back if NOT in an input field
        if (!isInputField || key !== 8) {
          e.preventDefault();
          e.stopPropagation();
          this.goBack();
        }
        // If in input field and key is backspace (8), let it work normally
        break;
      case 403: // Red button
        e.preventDefault();
        if (isPlayerScreen) {
          window.app.toggleMute();
        } else {
          this.handleColorButton('red');
        }
        break;
      case 404: // Green button
        e.preventDefault();
        // Focus Channel Search (Category Search is usually covered by Yellow/Red or just focus)
        // User asked for "focus ke search category"
        if (window.app && window.app.isOverlayMode) {
             const catSearch = document.getElementById("category-search");
             if (catSearch) catSearch.focus();
        } else {
             this.handleColorButton('green');
        }
        break;
      case 405: // Yellow button
        e.preventDefault();
        this.handleColorButton('yellow');
        break;
      case 406: // Blue button
        e.preventDefault();
        // Allow toggling if in player OR in overlay mode (where currentScreen="main")
        if (isPlayerScreen || (window.app && window.app.isOverlayMode)) {
            window.app.toggleOverlayMode();
        } else {
            this.handleColorButton('blue');
        }
        break;
    }
  }
  
  // Custom Methods
  goBack() {
    this.debugLog('Action: Back');
    if (window.app) {
      window.app.handleBack();
    } else if (window.homeScreen) {
      window.homeScreen.handleBack();
    } else {
      window.history.back();
    }
  }

  handleColorButton(color) {
    this.debugLog('Action: Color ' + color);
    if (window.homeScreen && color === 'yellow') {
        window.homeScreen.refreshPortals();
        return;
    }
    const event = new CustomEvent('colorbutton', { detail: { color } });
    document.dispatchEvent(event);
  }
}

// Expose globally
window.Navigation = Navigation;
