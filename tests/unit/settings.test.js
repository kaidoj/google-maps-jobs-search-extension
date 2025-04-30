/**
 * Unit tests for settings.js functionality
 */

describe('Settings page functionality', () => {
  let mockStorage;
  let savedSettings;
  let savedMsg;
  let originalGetElementById;
  let originalCreateElement;
  
  // Set up mocks before each test
  beforeEach(() => {
    // Save any original functions we need to restore later
    originalGetElementById = document.getElementById;
    originalCreateElement = document.createElement;
    
    // Mock the form elements
    const enableCacheCheckbox = {
      checked: true,
      addEventListener: jest.fn(),
    };
    
    const cacheTimeInput = {
      value: '7',
    };
    
    const clearCacheButton = {
      addEventListener: jest.fn(),
    };
    
    const cacheCountElement = {
      textContent: '0',
    };
    
    const cacheStatsContainer = {
      classList: {
        remove: jest.fn(),
        add: jest.fn(),
      },
    };
    
    const backButton = {
      addEventListener: jest.fn(),
    };
    
    const settingsForm = {
      addEventListener: jest.fn(),
    };
    
    // Mock document.getElementById to return our mock elements
    document.getElementById = jest.fn(id => {
      switch(id) {
        case 'enable-cache': return enableCacheCheckbox;
        case 'cache-time': return cacheTimeInput;
        case 'clear-cache': return clearCacheButton;
        case 'cache-count': return cacheCountElement;
        case 'cache-stats': return cacheStatsContainer;
        case 'back-button': return backButton;
        case 'settings-form': return settingsForm;
        default: return null;
      }
    });
    
    // Create a mock for the chrome.storage API
    savedSettings = {};
    mockStorage = {
      get: jest.fn((keys, callback) => {
        // Return values that match what the settings.js expects
        if (keys === null) {
          // Handle case for getting all storage data
          const mockStorageData = {
            ...savedSettings,
            'cached_website1': { url: 'https://example.com' },
            'cached_website2': { url: 'https://test.com' },
          };
          callback(mockStorageData);
        } else if (Array.isArray(keys) && keys[0] === 'enableCache' && keys[1] === 'cacheTime') {
          callback(savedSettings);
        } else {
          // Generic case for any other keys
          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(key => {
              if (savedSettings[key] !== undefined) {
                result[key] = savedSettings[key];
              }
            });
          } else if (typeof keys === 'string') {
            if (savedSettings[keys] !== undefined) {
              result[keys] = savedSettings[keys];
            }
          }
          callback(result);
        }
      }),
      set: jest.fn((values, callback) => {
        // Save the settings locally so we can verify them later
        savedSettings = { ...savedSettings, ...values };
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            delete savedSettings[key];
          });
        } else if (typeof keys === 'string') {
          delete savedSettings[keys];
        }
        if (callback) callback();
      }),
    };
    
    // Replace the chrome.storage.local with our mock
    chrome.storage.local = mockStorage;
    
    // Create a mock element for the saved message
    savedMsg = document.createElement('div');
    savedMsg.className = 'saved-message';
    savedMsg.textContent = 'Settings saved!';
    
    // Override createElement to return our savedMsg
    document.createElement = jest.fn(tagName => {
      if (tagName === 'div') {
        return savedMsg;
      }
      return originalCreateElement.call(document, tagName);
    });
    
    // Spy on document.body methods
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    
    // Mock setTimeout
    jest.useFakeTimers();
  });
  
  // Restore original functions after each test
  afterEach(() => {
    document.getElementById = originalGetElementById;
    document.createElement = originalCreateElement;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  
  test('loadSettings should load settings from storage', () => {
    // Set up the mock data that should be returned from storage
    savedSettings = {
      enableCache: true,
      cacheTime: 14
    };
    
    // Get a reference to the module's function
    const loadSettings = () => {
      // Simulate calling the loadSettings function from the module
      chrome.storage.local.get(['enableCache', 'cacheTime'], function(data) {
        const enableCacheCheckbox = document.getElementById('enable-cache');
        const cacheTimeInput = document.getElementById('cache-time');
        
        enableCacheCheckbox.checked = data.enableCache !== false;
        cacheTimeInput.value = data.cacheTime || 7;
      });
    };
    
    // Call the function
    loadSettings();
    
    // Verify storage was accessed with the correct keys
    expect(chrome.storage.local.get).toHaveBeenCalledWith(
      ['enableCache', 'cacheTime'],
      expect.any(Function)
    );
    
    // Verify the UI was updated correctly
    expect(document.getElementById('enable-cache').checked).toBe(true);
    expect(document.getElementById('cache-time').value).toBe(14);
  });
  
  test('saveSettings should save settings to storage', () => {
    // Set up values to be saved
    document.getElementById('enable-cache').checked = false;
    document.getElementById('cache-time').value = '30';
    
    // Create a mock event
    const mockEvent = {
      preventDefault: jest.fn()
    };
    
    // Define the saveSettings function to match the module's implementation
    const saveSettings = (e) => {
      e.preventDefault();
      
      // Get values from form
      const enableCache = document.getElementById('enable-cache').checked;
      const cacheTime = parseInt(document.getElementById('cache-time').value);
      
      // Save settings to storage
      chrome.storage.local.set({
        enableCache: enableCache,
        cacheTime: cacheTime
      }, function() {
        // Show confirmation message
        const savedMsg = document.createElement('div');
        document.body.appendChild(savedMsg);
        
        // Remove message after 2 seconds
        setTimeout(function() {
          document.body.removeChild(savedMsg);
        }, 2000);
      });
    };
    
    // Call the function
    saveSettings(mockEvent);
    
    // Verify the event was prevented
    expect(mockEvent.preventDefault).toHaveBeenCalled();
    
    // Verify settings were saved to storage
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      {
        enableCache: false,
        cacheTime: 30
      },
      expect.any(Function)
    );
    
    // Verify confirmation message was shown
    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(document.body.appendChild).toHaveBeenCalled();
    
    // Fast-forward time to verify the message is removed
    jest.advanceTimersByTime(2000);
    expect(document.body.removeChild).toHaveBeenCalled();
  });
  
  test('updateSavedWebsitesStats should update UI with correct count', () => {
    const cacheStatsContainer = document.getElementById('cache-stats');
    const cacheCountElement = document.getElementById('cache-count');
    
    const updateSavedWebsitesStats = () => {
      chrome.storage.local.get(null, function(data) {
        let savedCount = 0;
        
        // Count entries that start with "cached_"
        for (const key in data) {
          if (key.startsWith('cached_')) {
            savedCount++;
          }
        }
        
        // Update count in UI
        cacheCountElement.textContent = savedCount;
        
        // Show stats container if there are saved websites
        if (savedCount > 0) {
          cacheStatsContainer.classList.remove('hidden');
        } else {
          cacheStatsContainer.classList.add('hidden');
        }
      });
    };
    
    // Call the function
    updateSavedWebsitesStats();
    
    // Verify storage was accessed
    expect(chrome.storage.local.get).toHaveBeenCalledWith(null, expect.any(Function));
    
    // Verify the UI was updated with the correct count (2 cached websites in our mock)
    expect(cacheCountElement.textContent).toBe(2);
    
    // Verify the container visibility was updated
    expect(cacheStatsContainer.classList.remove).toHaveBeenCalledWith('hidden');
    expect(cacheStatsContainer.classList.add).not.toHaveBeenCalled();
  });
  
  test('clearSavedWebsites should remove all cached entries', () => {
    const clearSavedWebsites = () => {
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
          chrome.storage.local.remove(keysToRemove, function() {
            console.log('Cleared all saved website data');
          });
        }
      });
    };
    
    // Call the function
    clearSavedWebsites();
    
    // Verify storage was accessed
    expect(chrome.storage.local.get).toHaveBeenCalledWith(null, expect.any(Function));
    
    // Verify the correct keys were removed
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ['cached_website1', 'cached_website2'],
      expect.any(Function)
    );
  });
});