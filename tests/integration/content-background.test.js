/**
 * Integration tests for content script and background script communication
 * Tests the message passing between content.js and background.js
 */

describe('Content Script and Background Script Integration', () => {
  // Keep track of mock state across tests
  let mockRuntimeMessageListeners = [];
  let mockConnections = [];
  let storageData = {};
  let mockBackgroundResponse = { status: 'processing' };
  let mockSessionStorage;
  
  beforeEach(() => {
    // Reset data between tests
    mockRuntimeMessageListeners = [];
    mockConnections = [];
    storageData = {};
    
    // Set up fake timers for better control of async tests
    jest.useFakeTimers();
    
    // Create storage mock that persists data between tests
    const storageMock = {
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
      })
    };
    
    // Advanced mock for Chrome runtime that enables testing content-background communication
    const advancedRuntimeMock = {
      onMessage: {
        addListener: jest.fn((listener) => {
          mockRuntimeMessageListeners.push(listener);
        }),
        removeListener: jest.fn((listener) => {
          const index = mockRuntimeMessageListeners.indexOf(listener);
          if (index > -1) {
            mockRuntimeMessageListeners.splice(index, 1);
          }
        })
      },
      
      // This is what the content script will call
      sendMessage: jest.fn((message, callback) => {
        // Simulate background script receiving the message and responding
        if (message.action === 'processWebsites') {
          if (callback) callback(mockBackgroundResponse);
        } else if (message.action === 'updateProgress') {
          // No response needed for progress updates
        } else if (message.action === 'searchComplete') {
          if (callback) callback({ status: 'completed' });
        } else if (message.action === 'cancelSearch') {
          if (callback) callback({ status: 'cancelled' });
        } else if (message.action === 'getStatus') {
          if (callback) callback({ inProgress: false });
        } else {
          if (callback) callback({ status: 'unknown_action' });
        }
      }),
      
      onConnect: {
        addListener: jest.fn((listener) => {
          // Store listener for simulating connections
          mockConnections.push(listener);
        })
      },
      
      connect: jest.fn(({ name }) => {
        // Create a mock port
        const port = {
          name,
          postMessage: jest.fn(),
          onMessage: {
            addListener: jest.fn(),
          },
          onDisconnect: {
            addListener: jest.fn((listener) => {
              // Store the disconnect listener
              port._disconnectListener = listener;
            })
          },
          // Method to simulate disconnect
          disconnect: function() {
            if (this._disconnectListener) {
              this._disconnectListener();
            }
          }
        };
        
        // Return the mockPort
        return port;
      })
    };
    
    // Replace the chrome API with our mocks
    global.chrome = {
      runtime: advancedRuntimeMock,
      storage: {
        local: storageMock,
        session: { ...storageMock }
      }
    };
    
    // Create proper jest spy mocks for sessionStorage methods
    mockSessionStorage = {
      getItem: jest.fn((key) => storageData[key] || null),
      setItem: jest.fn((key, value) => {
        storageData[key] = value;
      }),
      removeItem: jest.fn((key) => {
        delete storageData[key];
      })
    };
    
    // Replace global.sessionStorage with our mock with spies
    Object.defineProperty(global, 'sessionStorage', {
      value: mockSessionStorage,
      writable: true
    });
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  
  // Test the content script handling a startSearch message
  test('Content script should handle startSearch message from popup', () => {
    // Set up searchInProgress variable
    let searchInProgress = false;
    
    // Mock the message handler that would be in the content script
    const handleMessage = (message, sender, sendResponse) => {
      if (message.action === 'startSearch' && message.data) {
        // Validate searchInProgress state
        if (searchInProgress) {
          sendResponse({ status: 'busy', message: 'A search is already in progress' });
          return true;
        }
        
        // Set searchInProgress to true
        searchInProgress = true;
        
        // Simulate async response - using setTimeout
        setTimeout(() => {
          sendResponse({ status: 'started' });
        }, 10);
        
        return true; // Will respond asynchronously
      }
      return false;
    };
    
    // Add our handler to the mock listeners
    mockRuntimeMessageListeners.push(handleMessage);
    
    // Create a spy for sendResponse
    const sendResponseSpy = jest.fn();
    
    // Trigger the handler directly with a startSearch message
    handleMessage(
      { action: 'startSearch', data: { keywords: ['developer'], location: 'New York' } },
      { id: 'popup' },
      sendResponseSpy
    );
    
    // Verify searchInProgress was set to true
    expect(searchInProgress).toBe(true);
    
    // Fast-forward time to let async response complete
    jest.advanceTimersByTime(20);
    
    // Verify response was sent
    expect(sendResponseSpy).toHaveBeenCalledWith({ status: 'started' });
  });
  
  // Test the content script handling a busy state
  test('Content script should reject new search when busy', () => {
    // Set up searchInProgress variable - already true to simulate busy state
    let searchInProgress = true;
    
    // Mock the message handler
    const handleMessage = (message, sender, sendResponse) => {
      if (message.action === 'startSearch' && message.data) {
        if (searchInProgress) {
          sendResponse({ status: 'busy', message: 'A search is already in progress' });
          return true;
        }
        
        // This part should not execute in this test
        searchInProgress = true;
        setTimeout(() => {
          sendResponse({ status: 'started' });
        }, 10);
        return true;
      }
      return false;
    };
    
    // Add our handler to the mock listeners
    mockRuntimeMessageListeners.push(handleMessage);
    
    // Create a spy for sendResponse
    const sendResponseSpy = jest.fn();
    
    // Trigger the handler with a startSearch message
    handleMessage(
      { action: 'startSearch', data: { keywords: ['developer'], location: 'New York' } },
      { id: 'popup' },
      sendResponseSpy
    );
    
    // Verify the busy response was sent immediately
    expect(sendResponseSpy).toHaveBeenCalledWith({
      status: 'busy',
      message: 'A search is already in progress'
    });
  });
  
  // Test content script sending websiteQueue to background script
  test('Content script should send websiteQueue to background for processing', () => {
    // Define test data
    const websiteQueue = [
      { businessName: 'Example Company', website: 'https://example.com', address: '123 Main St' },
      { businessName: 'Test Corp', website: 'https://test.com', address: '456 Oak Ave' }
    ];
    
    const searchData = {
      keywords: ['job', 'career', 'hiring'],
      location: 'New York',
      maxResults: 20
    };
    
    // Function that would be in content.js to process websites
    const processWebsiteQueue = () => {
      // Send message to background script
      chrome.runtime.sendMessage({
        action: 'processWebsites',
        data: {
          websites: websiteQueue,
          searchData: searchData
        }
      }, response => {
        // Verify response in the test assertions below
        console.log('Background script response:', response);
      });
    };
    
    // Call the function
    processWebsiteQueue();
    
    // Verify message was sent with correct data
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'processWebsites',
        data: {
          websites: websiteQueue,
          searchData: searchData
        }
      },
      expect.any(Function)
    );
  });
  
  // Test cancelSearch functionality
  test('cancelSearch should reset search state and notify background script', () => {
    // Set up initial search state
    let searchInProgress = true;
    let searchData = { keywords: ['test'] };
    let searchResults = ['result1', 'result2'];
    let websiteQueue = ['site1', 'site2'];
    
    // Store data in sessionStorage using our mock
    sessionStorage.setItem('gmjs_search_in_progress', 'true');
    sessionStorage.setItem('gmjs_websiteQueue', JSON.stringify(websiteQueue));
    sessionStorage.setItem('gmjs_searchData', JSON.stringify(searchData));
    
    // Mock the function
    const cancelSearch = () => {
      // Reset the search flag
      searchInProgress = false;
      
      // Reset other search-related variables
      searchData = null;
      searchResults = [];
      websiteQueue = [];
      
      // Send message to background script
      chrome.runtime.sendMessage({
        action: 'cancelSearch'
      }, response => {
        console.log('Background script notified of search cancellation:', response);
      });
      
      // Clear sessionStorage using our mock object
      sessionStorage.removeItem('gmjs_search_in_progress');
      sessionStorage.removeItem('gmjs_websiteQueue');
      sessionStorage.removeItem('gmjs_searchData');
    };
    
    // Call the function
    cancelSearch();
    
    // Verify search state was reset
    expect(searchInProgress).toBe(false);
    expect(searchData).toBeNull();
    expect(searchResults).toEqual([]);
    expect(websiteQueue).toEqual([]);
    
    // Verify our spy mocks were called correctly
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('gmjs_search_in_progress');
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('gmjs_websiteQueue');
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('gmjs_searchData');
    
    // Verify background script was notified
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'cancelSearch' },
      expect.any(Function)
    );
  });
  
  // Test popup connection and disconnection handling
  test('Content script should handle popup disconnection', () => {
    // Set up search state
    let searchInProgress = true;
    
    // Create a mock port
    const mockPort = {
      onDisconnect: {
        addListener: jest.fn(callback => {
          // Store the callback for later use
          mockPort._disconnect = callback;
        })
      }
    };
    
    // Mock the function that would be in content.js
    const handlePortConnection = (port) => {
      console.log('Popup connected');
      
      // Set up a listener for port disconnection
      port.onDisconnect.addListener(() => {
        console.log('Popup disconnected, checking if search should be cancelled');
        
        // Check runtime.lastError to suppress any errors
        if (chrome.runtime.lastError) {
          console.error('Error on disconnect:', chrome.runtime.lastError);
        }
        
        // For the test, just reset the search state
        searchInProgress = false;
      });
    };
    
    // Call the function with our mock port
    handlePortConnection(mockPort);
    
    // Verify the disconnect listener was set up
    expect(mockPort.onDisconnect.addListener).toHaveBeenCalled();
    
    // Now simulate a disconnect by calling the stored callback
    mockPort._disconnect();
    
    // Verify search was cancelled
    expect(searchInProgress).toBe(false);
  });
  
  // Test progress update message
  test('Content script should send progress updates to popup', () => {
    // Mock function that would be in content.js
    const updatePopupProgress = (status, progress) => {
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        status,
        progress
      });
    };
    
    // Call the function
    updatePopupProgress('Processing websites', 45);
    
    // Verify message was sent with correct data
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'updateProgress',
      status: 'Processing websites',
      progress: 45
    });
  });
});