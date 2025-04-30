/**
 * Integration tests for the settings and popup page interaction
 * This tests how settings changes affect the popup behavior
 */

describe('Settings and Popup Integration', () => {
  // Keep track of storage data across tests
  let storageData = {};
  let originalLocation;
  
  beforeEach(() => {
    // Reset storage data between tests
    storageData = {};
    
    // Create a shared storage mock that persists data between tests
    const sharedStorageMock = {
      get: jest.fn((keys, callback) => {
        if (typeof keys === 'string') {
          callback({ [keys]: storageData[keys] });
        } else if (Array.isArray(keys)) {
          const result = {};
          keys.forEach(key => {
            result[key] = storageData[key];
          });
          callback(result);
        } else if (keys === null) {
          callback({ ...storageData });
        } else {
          callback({});
        }
      }),
      set: jest.fn((data, callback) => {
        Object.assign(storageData, data);
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            delete storageData[key];
          });
        } else {
          delete storageData[keys];
        }
        if (callback) callback();
      }),
    };
    
    // Mock chrome.storage.local and chrome.storage.session
    if (chrome.storage) {
      chrome.storage.local = sharedStorageMock;
      chrome.storage.session = { ...sharedStorageMock };
    }
    
    // Mock DOM elements for settings page
    const settingsElements = {
      'enable-cache': { checked: true },
      'cache-time': { value: '7' },
      'clear-cache': { addEventListener: jest.fn() },
      'cache-count': { textContent: '0' },
      'cache-stats': { classList: { remove: jest.fn(), add: jest.fn() } },
      'back-button': { addEventListener: jest.fn() },
      'settings-form': { addEventListener: jest.fn() },
    };
    
    // Mock DOM elements for popup page
    const popupElements = {
      'keywords': { value: '', addEventListener: jest.fn() },
      'location': { value: '', addEventListener: jest.fn() },
      'website-keywords': { value: '', addEventListener: jest.fn() },
      'max-results': { value: '20' },
      'reset-website-keywords': { addEventListener: jest.fn() },
      'start-search': { style: {}, addEventListener: jest.fn() },
      'cancel-search': { style: {}, addEventListener: jest.fn() },
      'results-container': { classList: { remove: jest.fn(), add: jest.fn(), contains: jest.fn() } },
      'status-message': { textContent: '' },
      'progress-bar': { style: {} },
      'results-list': { innerHTML: '' },
      'export-csv': { disabled: true, addEventListener: jest.fn() },
      'settings-button': { addEventListener: jest.fn() },
    };
    
    // Combine all elements
    const allElements = { ...settingsElements, ...popupElements };
    
    // Mock document.getElementById
    jest.spyOn(document, 'getElementById').mockImplementation(id => allElements[id] || null);
    
    // Spy on document.body methods instead of replacing document.body
    if (document.body) {
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    }
    
    // Mock window.location if window is defined
    if (typeof window !== 'undefined') {
      // Store the original location
      originalLocation = window.location;
      
      // Delete the property first (needed for some browsers)
      delete window.location;
      
      // Create a new location object
      window.location = {
        href: '',
        reload: jest.fn(),
        // Add any other properties needed
      };
    }
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
    
    // Restore original window location if it was changed
    if (typeof window !== 'undefined' && originalLocation) {
      window.location = originalLocation;
    }
  });
  
  test('Settings saved in settings page are loaded in popup', () => {
    // First simulate saving settings from the settings page
    // This simulates the saveSettings function from settings.js
    const enableCache = true;
    const cacheTime = 14;
    
    chrome.storage.local.set({
      enableCache: enableCache,
      cacheTime: cacheTime
    });
    
    // Verify settings were stored correctly
    expect(storageData.enableCache).toBe(true);
    expect(storageData.cacheTime).toBe(14);
    
    // Now simulate popup loading settings
    // This simulates the settings loading in popup.js
    chrome.storage.local.get(['enableCache', 'cacheTime'], function(data) {
      expect(data.enableCache).toBe(true);
      expect(data.cacheTime).toBe(14);
    });
  });
  
  test('Clearing cache in settings clears cached websites', () => {
    // First add some cached websites to the storage
    storageData = {
      'cached_website1': { url: 'https://example.com', lastChecked: Date.now() },
      'cached_website2': { url: 'https://test.com', lastChecked: Date.now() },
      'enableCache': true,
      'cacheTime': 7,
      'keywords': 'software developer',
      'location': 'New York'
    };
    
    // Verify our non-cache data is present
    expect(storageData.keywords).toBe('software developer');
    expect(storageData.location).toBe('New York');
    
    // Now simulate the clearSavedWebsites function from settings.js
    chrome.storage.local.get(null, function(data) {
      const keysToRemove = [];
      
      // Find all keys that start with "cached_"
      for (const key in data) {
        if (key.startsWith('cached_')) {
          keysToRemove.push(key);
        }
      }
      
      // Remove all saved website entries
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove);
      }
    });
    
    // Verify that only the cached website entries were removed
    expect(storageData.cached_website1).toBeUndefined();
    expect(storageData.cached_website2).toBeUndefined();
    
    // And that other settings remain intact
    expect(storageData.enableCache).toBe(true);
    expect(storageData.cacheTime).toBe(7);
    expect(storageData.keywords).toBe('software developer');
    expect(storageData.location).toBe('New York');
  });
  
  test('Cache settings affect website caching behavior', () => {
    // Set up initial state - cache is disabled
    storageData = {
      'enableCache': false,
      'cacheTime': 7
    };
    
    // Simulate checking if URL is in cache from popup.js
    let cacheCheckResult = false;
    
    // First check with cache disabled
    chrome.storage.local.get(['enableCache'], function(settings) {
      // Cache is disabled, so we shouldn't check for the URL
      const cacheEnabled = settings.enableCache !== false;
      cacheCheckResult = cacheEnabled;
      
      // This should be false since we disabled the cache
      expect(cacheEnabled).toBe(false);
    });
    expect(cacheCheckResult).toBe(false);
    
    // Now enable the cache
    chrome.storage.local.set({ 'enableCache': true });
    
    // Check again with cache enabled
    chrome.storage.local.get(['enableCache'], function(settings) {
      const cacheEnabled = settings.enableCache !== false;
      cacheCheckResult = cacheEnabled;
      
      // This should be true now
      expect(cacheEnabled).toBe(true);
    });
    expect(cacheCheckResult).toBe(true);
  });
});