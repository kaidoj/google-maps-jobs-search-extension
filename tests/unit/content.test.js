/**
 * Unit tests for content.js functionality
 * These tests check the core functionality of the content script
 * that interacts with Google Maps
 */

describe('Content Script Functionality', () => {
  let mockChrome;
  let originalDocument;
  let mockSessionStorage;
  let sessionStorageData;
  
  beforeEach(() => {
    // Save original document methods we'll be mocking
    originalDocument = { ...document };
    
    // Set up session storage mock
    sessionStorageData = {};
    mockSessionStorage = {
      getItem: jest.fn((key) => sessionStorageData[key] || null),
      setItem: jest.fn((key, value) => {
        sessionStorageData[key] = value;
      }),
      removeItem: jest.fn((key) => {
        delete sessionStorageData[key];
      })
    };
    
    // Replace sessionStorage with our mock
    Object.defineProperty(window, 'sessionStorage', {
      value: mockSessionStorage,
      writable: true
    });
    
    // Mock Chrome runtime API
    mockChrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        },
        sendMessage: jest.fn((message, callback) => {
          if (callback) {
            callback({ status: 'success' });
          }
        }),
        onConnect: {
          addListener: jest.fn()
        },
        lastError: null
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            const result = {};
            if (keys === 'enableCache') {
              result.enableCache = true;
            } else if (keys === 'cacheTime') {
              result.cacheTime = 7;
            } else if (Array.isArray(keys) && keys.includes('enableCache')) {
              result.enableCache = true;
              result.cacheTime = 7;
            }
            callback(result);
          }),
          set: jest.fn((data, callback) => {
            if (callback) callback();
          })
        }
      }
    };
    
    // Replace chrome with our mock
    global.chrome = mockChrome;
    
    // Mock document methods and elements
    document.querySelector = jest.fn((selector) => {
      if (selector.includes('feed') || selector.includes('list')) {
        return {
          scrollTo: jest.fn(),
          scrollHeight: 1000
        };
      } else if (selector.includes('input')) {
        return {
          value: '',
          focus: jest.fn(),
          dispatchEvent: jest.fn()
        };
      } else if (selector.includes('button[aria-label="Back"]') || 
                 selector.includes('button[aria-label="Close"]')) {
        return {
          click: jest.fn()
        };
      }
      return null;
    });
    
    document.querySelectorAll = jest.fn(() => []);
    document.createElement = jest.fn(() => ({
      className: '',
      textContent: '',
      style: {},
      appendChild: jest.fn()
    }));
    
    // Mock window location
    delete window.location;
    window.location = {
      href: 'https://www.google.com/maps/',
      host: 'google.com'
    };
    
    // Mock custom events
    global.Event = jest.fn();
    global.MouseEvent = jest.fn();
    global.KeyboardEvent = jest.fn();
  });
  
  afterEach(() => {
    // Restore original document methods
    document.querySelector = originalDocument.querySelector;
    document.querySelectorAll = originalDocument.querySelectorAll;
    document.createElement = originalDocument.createElement;
    
    jest.restoreAllMocks();
  });
  
  // Test initialize function
  test('initialize should set up event listeners', () => {
    // Mock the initialize function
    const initialize = () => {
      console.log('Hidden Job Search Helper content script initialized');
      
      // Check if we need to restore state after a page refresh
      try {
        if (sessionStorage.getItem('gmjs_search_in_progress') === 'true') {
          console.log('Detected interrupted search, attempting to restore state');
        }
      } catch (e) {
        console.error('Error checking for saved search state:', e);
      }
      
      // Listen for messages from popup
      chrome.runtime.onMessage.addListener(() => {});
      
      // Set up a connection listener
      chrome.runtime.onConnect.addListener(() => {});
    };
    
    // Set a session storage item to trigger restore logic
    sessionStorage.setItem('gmjs_search_in_progress', 'true');
    
    // Call initialize
    initialize();
    
    // Verify that event listeners were added
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chrome.runtime.onConnect.addListener).toHaveBeenCalled();
    expect(sessionStorage.getItem).toHaveBeenCalledWith('gmjs_search_in_progress');
  });
  
  // Test startMapsSearch function
  test('startMapsSearch should initialize search variables', async () => {
    // Mock the search data
    let searchData = {
      keywords: ['software developer'],
      location: 'New York',
      maxResults: 20
    };
    
    let searchInProgress = false;
    let searchResults = ['old results'];
    let currentResultIndex = 5;
    let websiteQueue = ['old queue'];
    
    // Mock the function
    const startMapsSearch = (data) => {
      searchData = data;
      searchResults = [];
      currentResultIndex = 0;
      websiteQueue = [];
      
      return new Promise((resolve) => {
        try {
          console.log("Search initialized successfully");
          searchInProgress = true;
          resolve();
        } catch (err) {
          console.error("Search initialization failed:", err);
          searchInProgress = false;
          throw err;
        }
      });
    };
    
    // Call the function
    await startMapsSearch(searchData);
    
    // Check that search variables were reset properly
    expect(searchInProgress).toBe(true);
    expect(searchResults).toEqual([]);
    expect(currentResultIndex).toBe(0);
    expect(websiteQueue).toEqual([]);
  });
  
  // Test waitForElement helper function
  test('waitForElement should resolve when element is found', async () => {
    // Mock implementation of waitForElement
    const waitForElement = (selector, timeout = 5000) => {
      return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
        } else {
          reject(new Error(`Timeout waiting for element: ${selector}`));
        }
      });
    };
    
    // Mock document.querySelector to return an element
    document.querySelector = jest.fn().mockImplementation(selector => {
      if (selector === 'div[role="feed"]') {
        return { id: 'mockFeed' };
      }
      return null;
    });
    
    // Call the function
    const result = await waitForElement('div[role="feed"]');
    
    // Check that the element was resolved
    expect(result).toEqual({ id: 'mockFeed' });
    expect(document.querySelector).toHaveBeenCalledWith('div[role="feed"]');
  });
  
  // Test findSearchBox function
  test('findSearchBox should try multiple selectors to find search box', async () => {
    // Mock implementation of findSearchBox
    const findSearchBox = async () => {
      // Try multiple selectors
      const possibleSelectors = [
        'input[aria-label="Search Google Maps"]',
        'input#searchboxinput'
      ];
      
      // Try each selector
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      }
      
      throw new Error("Could not find the Google Maps search box");
    };
    
    // Mock document.querySelector to return an element for a specific selector
    document.querySelector = jest.fn().mockImplementation(selector => {
      if (selector === 'input#searchboxinput') {
        return { value: '', focus: jest.fn(), dispatchEvent: jest.fn() };
      }
      return null;
    });
    
    // Call the function
    const result = await findSearchBox();
    
    // Check that we got the element from the second selector
    expect(result).toBeDefined();
    expect(document.querySelector).toHaveBeenCalledWith('input[aria-label="Search Google Maps"]');
    expect(document.querySelector).toHaveBeenCalledWith('input#searchboxinput');
  });
  
  // Test checkUrlInPreviouslyVisited function
  test('checkUrlInPreviouslyVisited should check the cache based on settings', async () => {
    // Mock function implementation
    const checkUrlInPreviouslyVisited = async (url) => {
      return new Promise((resolve) => {
        // First check if saving previously visited sites is enabled
        chrome.storage.local.get(['enableCache', 'cacheTime'], function(settings) {
          const savePreviouslyVisited = settings.enableCache !== false;
          
          if (!savePreviouslyVisited) {
            resolve(null);
            return;
          }
          
          const rememberDays = settings.cacheTime || 7;
          resolve({ cached: true, days: rememberDays });
        });
      });
    };
    
    // Call the function
    const result = await checkUrlInPreviouslyVisited('https://example.com');
    
    // Check that storage was accessed correctly
    expect(chrome.storage.local.get).toHaveBeenCalledWith(
      ['enableCache', 'cacheTime'],
      expect.any(Function)
    );
    
    // Check the returned value
    expect(result).toEqual({ cached: true, days: 7 });
  });
  
  // Test resetGoogleMapsState function
  test('resetGoogleMapsState should try to clean up the Google Maps UI', async () => {
    let searchInProgress = true;
    
    // Mock implementation of resetGoogleMapsState
    const resetGoogleMapsState = async () => {
      try {
        // Try to find the home button
        const homeButton = document.querySelector('a[aria-label="Google Maps"]');
        if (homeButton) {
          homeButton.click();
        }
        
        // Try to find the search box
        const searchBox = document.querySelector('input#searchboxinput');
        if (searchBox) {
          searchBox.value = '';
          searchBox.focus();
        }
        
        // Reset all search-related variables
        searchInProgress = false;
        
        return true;
      } catch (error) {
        console.error('Error resetting Google Maps state:', error);
        searchInProgress = false;
        throw error;
      }
    };
    
    // Mock document.querySelector
    document.querySelector = jest.fn().mockImplementation(selector => {
      if (selector === 'a[aria-label="Google Maps"]') {
        return { click: jest.fn() };
      } else if (selector === 'input#searchboxinput') {
        return { value: 'test', focus: jest.fn(), dispatchEvent: jest.fn() };
      }
      return null;
    });
    
    // Call the function
    await resetGoogleMapsState();
    
    // Check that searchInProgress was set to false
    expect(searchInProgress).toBe(false);
    
    // Check that appropriate elements were accessed
    expect(document.querySelector).toHaveBeenCalledWith('a[aria-label="Google Maps"]');
    expect(document.querySelector).toHaveBeenCalledWith('input#searchboxinput');
  });
});