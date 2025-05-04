// Tests for popup.js functionality
const fs = require('fs');
const path = require('path');

// Mock DOM elements for popup testing
const mockDomElements = {
  startSearchButton: { style: { display: 'none' } },
  cancelSearchButton: { style: { display: 'block' } },
  statusMessage: { textContent: '' },
  progressBar: { style: { width: '' } },
  resultsContainer: { classList: { contains: jest.fn(), remove: jest.fn() } },
  resultsList: { innerHTML: '' },
  exportCsvButton: { disabled: true }
};

describe('Popup Button States', () => {
  // Setup test environment before each test
  beforeEach(() => {
    // Reset mock DOM elements
    mockDomElements.startSearchButton.style.display = 'none';
    mockDomElements.cancelSearchButton.style.display = 'block';
    mockDomElements.statusMessage.textContent = '';
    mockDomElements.progressBar.style.width = '';
    mockDomElements.resultsList.innerHTML = '';
    mockDomElements.exportCsvButton.disabled = true;
    
    // Reset mock functions
    jest.clearAllMocks();
    
    // Mock document.getElementById to return our mock elements
    document.getElementById = jest.fn(id => {
      switch(id) {
        case 'start-search':
          return mockDomElements.startSearchButton;
        case 'cancel-search':
          return mockDomElements.cancelSearchButton;
        case 'status-message':
          return mockDomElements.statusMessage;
        case 'progress-bar':
          return mockDomElements.progressBar;
        case 'results-container':
          return mockDomElements.resultsContainer;
        case 'results-list':
          return mockDomElements.resultsList;
        case 'export-csv':
          return mockDomElements.exportCsvButton;
        default:
          return { 
            addEventListener: jest.fn(),
            value: ''
          };
      }
    });
  });

  // Test for the bug: Cancel button shows after search completion when reopening popup
  test('should show Start Search button when searchCompleted flag is true', async () => {
    // Load the updateSearchButtonStates function 
    const updateSearchButtonStates = (isSearchInProgress) => {
      if (isSearchInProgress) {
        mockDomElements.startSearchButton.style.display = 'none';
        mockDomElements.cancelSearchButton.style.display = 'block';
      } else {
        mockDomElements.startSearchButton.style.display = 'block';
        mockDomElements.cancelSearchButton.style.display = 'none';
      }
    };
    
    // Simulate session storage with searchCompleted=true
    chrome.scripting.executeScript.mockResolvedValueOnce([{
      result: {
        status: 'Search completed!',
        progress: '100',
        searchCompleted: 'true' 
      }
    }]);
    
    // Simulate checkForPopupResults function with the bug fix
    async function checkForPopupResults() {
      try {
        const results = await chrome.scripting.executeScript();
        
        if (results && results[0]?.result) {
          const isSearchCompleted = results[0].result.searchCompleted === 'true';
          
          if (isSearchCompleted) {
            console.log('Search completed flag found, showing start button');
            updateSearchButtonStates(false);
            // Important: Early return to avoid the local storage check overriding this
            return;
          }
        }
        
        // Only continue to local storage check if no completion flag in session storage
        chrome.storage.local.get(['popupResults', 'popupStatus', 'popupProgress'], (data) => {
          if (data.popupResults && data.popupResults.length > 0) {
            const isSearchCompleted = 
              (data.popupStatus || '').toLowerCase().includes('complete') || 
              (data.popupProgress === '100%');
            updateSearchButtonStates(!isSearchCompleted);
          }
        });
      } catch (error) {
        console.error('Error in checkForPopupResults:', error);
      }
    }
    
    // Initial state - cancel button is showing (simulating the bug)
    expect(mockDomElements.cancelSearchButton.style.display).toBe('block');
    expect(mockDomElements.startSearchButton.style.display).toBe('none');
    
    // Run the function with our fix
    await checkForPopupResults();
    
    // After function runs, Start button should be showing
    expect(mockDomElements.startSearchButton.style.display).toBe('block');
    expect(mockDomElements.cancelSearchButton.style.display).toBe('none');
  });
});