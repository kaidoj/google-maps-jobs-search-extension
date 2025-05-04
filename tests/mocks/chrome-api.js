/**
 * Mocks for Chrome Extension API functionality
 * This file provides mocks for the Chrome extension APIs to facilitate testing
 */

// Create a basic mock of the chrome.tabs API
const mockTabs = {
  query: jest.fn((options, callback) => {
    const tab = {
      id: 1,
      url: 'https://www.google.com/maps/',
      active: true,
      currentWindow: true
    };
    callback([tab]);
  }),
  sendMessage: jest.fn((tabId, message, callback) => {
    if (callback) {
      callback({ status: 'success' });
    }
  }),
  create: jest.fn(({ url }) => {
    console.log(`Mock: Creating tab with URL ${url}`);
    return Promise.resolve({ id: 2 });
  })
};

// Create a basic mock of the chrome.runtime API
const mockRuntime = {
  lastError: null,
  onMessage: {
    addListener: jest.fn((listener) => {
      // Store listener for future use
      mockRuntime._messageListeners = mockRuntime._messageListeners || [];
      mockRuntime._messageListeners.push(listener);
    }),
    removeListener: jest.fn((listener) => {
      if (mockRuntime._messageListeners) {
        const index = mockRuntime._messageListeners.indexOf(listener);
        if (index !== -1) {
          mockRuntime._messageListeners.splice(index, 1);
        }
      }
    })
  },
  sendMessage: jest.fn((message, callback) => {
    if (callback) {
      callback({ received: true });
    }
  }),
  connect: jest.fn(({ name }) => {
    return {
      name,
      postMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      },
      onDisconnect: {
        addListener: jest.fn()
      }
    };
  }),
  // Utility method to simulate receiving messages in tests
  _sendMessageToListeners: (message, sender) => {
    if (mockRuntime._messageListeners) {
      mockRuntime._messageListeners.forEach(listener => {
        listener(message, sender, (response) => {
          console.log('Mock: Received response to message', response);
        });
      });
    }
  }
};

// Create a mock for chrome.scripting API
const mockScripting = {
  executeScript: jest.fn(() => {
    return Promise.resolve([{
      result: {
        status: 'Search completed!',
        progress: '100',
        searchCompleted: 'true'
      }
    }]);
  })
};

// Export the mocks for use in tests
module.exports = {
  mockTabs,
  mockRuntime,
  mockScripting
};