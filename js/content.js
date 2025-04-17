// Content script for Google Maps interactions
let searchData = null;
let searchInProgress = false;
let searchResults = [];
let currentResultIndex = 0;
let websiteQueue = [];

// Initialize when the page loads
function initialize() {
  console.log('Google Maps Job Search content script initialized');
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message.action, message.data ? 'with data' : '');
    
    if (message.action === 'startSearch' && message.data) {
      console.log('Current searchInProgress state:', searchInProgress);
      
      // Double-check to make sure searchInProgress is actually false before proceeding
      if (searchInProgress) {
        console.log('Search already in progress, rejecting new search request');
        sendResponse({ status: 'busy', message: 'A search is already in progress' });
        return true;
      }
      
      // Store the response function for async use
      let responseFunction = sendResponse;
      
      try {
        // Force reset the search state to be absolutely sure it's clean
        searchInProgress = false;
        searchData = null;
        searchResults = [];
        currentResultIndex = 0;
        websiteQueue = [];
        
        // Now set searchInProgress to true for the new search
        searchInProgress = true;
        console.log('Setting searchInProgress to true');
        
        // Add a small delay before starting the search to ensure Google Maps UI is fully ready
        setTimeout(() => {
          console.log("Starting map search with data:", message.data);
          
          // Start the search process
          startMapsSearch(message.data)
            .then(() => {
              // Search successfully initiated
              if (responseFunction) {
                console.log('Search initialized successfully, sending started response');
                responseFunction({ status: 'started' });
                responseFunction = null;
              }
            })
            .catch(error => {
              // If there's an error starting the search
              console.error("Error starting search:", error);
              searchInProgress = false; // Reset the flag
              console.log('Setting searchInProgress to false due to error');
              if (responseFunction) {
                responseFunction({ status: 'error', error: error.message });
                responseFunction = null;
              }
            });
        }, 500);
      } catch (e) {
        console.error('Exception in startSearch handler:', e);
        searchInProgress = false;
        if (responseFunction) {
          responseFunction({ status: 'error', error: e.message });
          responseFunction = null;
        }
      }
      
      // Return true to indicate we'll respond asynchronously
      return true;
    } else if (message.action === 'getStatus') {
      sendResponse({
        inProgress: searchInProgress,
        currentStep: searchInProgress ? 'waiting' : null,
        progress: calculateProgress()
      });
      return false; // No asynchronous response needed
    } else if (message.action === 'resetGoogleMaps') {
      // Create a variable to store the response function
      let responseFunction = sendResponse;
      
      // Execute the reset
      resetGoogleMapsState()
        .then(() => {
          // Successfully reset - make sure we still have the response function
          if (responseFunction) {
            responseFunction({ status: 'reset_complete' });
            // Clear the reference after use to avoid potential memory leaks
            responseFunction = null;
          }
        })
        .catch(error => {
          console.error('Error resetting Google Maps state:', error);
          if (responseFunction) {
            responseFunction({ status: 'reset_failed', error: error.message });
            responseFunction = null;
          }
        });
      
      // Return true to indicate we'll call sendResponse asynchronously
      return true;
    } else if (message.action === 'cancelSearch') {
      // Cancel any ongoing search
      cancelSearch();
      sendResponse({ status: 'search_cancelled' });
      return false;
    } else if (message.action === 'popupOpened') {
      // Add debugging
      console.log('Popup opened, current searchInProgress state:', searchInProgress);
      // Reset search state if needed - this helps when popup was closed during search
      sendResponse({ inProgress: searchInProgress });
      return false;
    }
    
    // Default return for any other messages
    return false;
  });
  
  // Set up a connection listener to detect when the popup closes
  chrome.runtime.onConnect.addListener(port => {
    console.log('Popup connected');
    
    // Listen for popup disconnect
    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected, checking if search should be cancelled');
      
      // Check runtime.lastError to suppress any errors
      if (chrome.runtime.lastError) {
        console.error('Error on disconnect:', chrome.runtime.lastError);
      }
      
      // We'll wait a moment before checking if the popup reconnects
      // This helps with popup refreshes vs. actual closures
      setTimeout(() => {
        try {
          // Try to send a message to see if popup is still open
          chrome.runtime.sendMessage({ action: 'ping' }, response => {
            // If we get here without an error, the popup is still open
            if (chrome.runtime.lastError) {
              console.log('Popup is closed, cancelling any running search');
              cancelSearch();
            }
          });
        } catch (e) {
          // Error means popup is closed
          console.log('Popup is closed, cancelling any running search');
          cancelSearch();
        }
      }, 500);
    });
  });
}

// Start the search process on Google Maps
function startMapsSearch(data) {
  searchData = data;
  searchResults = [];
  currentResultIndex = 0;
  websiteQueue = [];
  
  // Return a promise that resolves when search initialization is complete
  return new Promise((resolve, reject) => {
    try {
      // Update the popup with progress
      updatePopupProgress('Preparing search...', 5);
      
      console.log("Search initialized successfully, data:", searchData);
      
      // Resolve the promise as successful initialization
      resolve();
      
      // Check if we need to search for a location first
      if (searchData.location && searchData.location.trim() !== '') {
        searchLocation(searchData.location);
      } else {
        // Use current map view and start the search
        startBusinessSearch();
      }
    } catch (err) {
      console.error("Search initialization failed:", err);
      searchInProgress = false;
      reject(err);
    }
  });
}

// Search for a location on Google Maps
function searchLocation(location) {
  updatePopupProgress(`Searching for location: ${location}...`, 10);
  
  // Find the search box and enter the location
  findSearchBox()
    .then(searchBox => {
      // Clear the search box
      searchBox.value = '';
      searchBox.focus();
      
      // Trigger input events
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Type the location
      searchBox.value = location;
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Wait a bit and press Enter
      setTimeout(() => {
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        
        // Wait for the search results to load
        setTimeout(() => {
          startBusinessSearch();
        }, 2000);
      }, 1000);
    })
    .catch(error => {
      updatePopupProgress(`Error: ${error.message}`, 0);
      searchInProgress = false;
    });
}

// Start the business search using the search query
function startBusinessSearch() {
  updatePopupProgress('Starting search with keywords...', 15);
  
  // Construct the search query based on "keywords in location" format
  let query = '';
  
  // Get the keywords from searchData
  if (searchData.keywords && searchData.keywords.length > 0) {
    // Join multiple keywords with space
    query = searchData.keywords.join(' ');
  } else {
    // Fallback if no keywords provided
    updatePopupProgress('No keywords provided for search', 0);
    searchInProgress = false;
    return;
  }
  
  // Add appropriate location to query
  if (!searchData.location || searchData.location.trim() === '') {
    // If no location specified, use "in current area"
    query += ' in current area';
  } else {
    // If location is specified, use "in [location]"
    query += ` in ${searchData.location.trim()}`;
  }
  
  // Find the search box and enter the search query
  findSearchBox()
    .then(searchBox => {
      // Clear the search box
      searchBox.value = '';
      searchBox.focus();
      
      // Trigger input events
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Type the search query
      searchBox.value = query;
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      updatePopupProgress(`Searching for: ${query}`, 18);
      
      // Wait a bit and press Enter
      setTimeout(() => {
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        
        // Wait for the search results to load
        setTimeout(() => {
          collectSearchResults();
        }, 2000);
      }, 1000);
    })
    .catch(error => {
      updatePopupProgress(`Error: ${error.message}`, 0);
      searchInProgress = false;
    });
}

// Collect search results from the Google Maps page
async function collectSearchResults() {
  updatePopupProgress('Collecting business results from Google Maps...', 20);
  
  // Try different selectors for the results feed with fallbacks
  try {
    const resultsFeed = await waitForElementWithOptions([
      'div[role="feed"]', 
      'div[role="list"]',
      '.section-result-content',
      '.section-scrollbox',
      '.lXJj5c',
      'div.m6QErb[aria-label]', // Modern Google Maps layout
      'div[jsaction*="pane.resultspanel"]',
      '.m6QErb div[role="region"]'
    ], 8000);
    
    // Set the maximum number of scrolls to try (prevent infinite scrolling)
    const MAX_SCROLL_ATTEMPTS = 10;
    let scrollAttempts = 0;
    let prevResultCount = 0;
    let resultItems = [];
    
    // Get the max results limit from searchData
    const maxResults = searchData.maxResults || 20;
    console.log(`Max results limit: ${maxResults}`);
    
    // Function to get all result items from the feed
    function getResultItems(feed) {
      // Try different selectors to find result items
      let items = feed.querySelectorAll('div[role="article"]');
      
      // Try alternative selectors if the first one didn't work
      if (items.length === 0) {
        items = feed.querySelectorAll('a[href^="https://www.google.com/maps/place"]');
      }
      
      // One more fallback
      if (items.length === 0) {
        items = feed.querySelectorAll('.bfdHYd');
      }
      
      // Final fallback - try to find anything that looks like a result card
      if (items.length === 0) {
        items = feed.querySelectorAll('div[jsaction*="mouseover"]');
      }
      
      return Array.from(items);
    }
    
    // Initial set of results
    resultItems = getResultItems(resultsFeed);
    
    // If no results found initially, stop the search
    if (resultItems.length === 0) {
      updatePopupProgress('No businesses found in the current map view', 0);
      searchInProgress = false;
      return;
    }
    
    // Log initial results count
    prevResultCount = resultItems.length;
    console.log(`Initially found ${prevResultCount} business results`);
    
    // If we already have enough results, don't scroll
    if (resultItems.length >= maxResults) {
      console.log(`Already have ${resultItems.length} results, which is >= max limit of ${maxResults}. Stopping scrolling.`);
      // Limit the result items to the max results
      resultItems = resultItems.slice(0, maxResults);
    } else {
      // Scroll and collect more results until we have enough or can't find more
      while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
        if (resultItems.length >= maxResults) {
          console.log(`Reached max results limit (${maxResults}). Stopping scrolling.`);
          // Limit the result items to the max results
          resultItems = resultItems.slice(0, maxResults);
          break;
        }
        
        updatePopupProgress(`Loading more results (scroll attempt ${scrollAttempts + 1})...`, 20 + (scrollAttempts / MAX_SCROLL_ATTEMPTS * 5));
        
        // Scroll the results feed to the bottom
        resultsFeed.scrollTo({
          top: resultsFeed.scrollHeight,
          behavior: 'smooth'
        });
        
        // Wait for potential new results to load
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Get updated list of results
        resultItems = getResultItems(resultsFeed);
        
        // If we didn't get any new results after scrolling, we can stop
        if (resultItems.length <= prevResultCount) {
          scrollAttempts++;
          
          // If we've tried a few times with no new results, assume we're at the end
          if (scrollAttempts >= 3 && resultItems.length === prevResultCount) {
            console.log('No new results after multiple scroll attempts, likely reached the end');
            break;
          }
        } else {
          // Reset attempts counter if we got new results
          scrollAttempts = 0;
          console.log(`Found ${resultItems.length - prevResultCount} new results (total: ${resultItems.length})`);
          prevResultCount = resultItems.length;
        }
      }
    }
    
    // Ensure we don't process more than the max results limit
    if (resultItems.length > maxResults) {
      console.log(`Limiting results to max ${maxResults} (found ${resultItems.length})`);
      resultItems = resultItems.slice(0, maxResults);
    }
    
    updatePopupProgress(`Found ${resultItems.length} businesses. Processing...`, 25);
    
    // Process each result item to get business info
    await processResultItems(resultItems);
    
  } catch (error) {
    updatePopupProgress(`Error collecting search results: ${error.message}`, 0);
    searchInProgress = false;
  }
}

// Process each result item to extract business information
async function processResultItems(resultItems) {
  updatePopupProgress(`Processing ${resultItems.length} businesses...`, 30);
  
  // Set to track URLs we've already processed to avoid duplicates
  const processedUrls = new Set();
  
  for (let i = 0; i < resultItems.length; i++) {
    const progress = 30 + (i / resultItems.length) * 20;
    updatePopupProgress(`Processing business ${i+1} of ${resultItems.length}...`, progress);
    
    try {
      // Click on the result item to view details
      resultItems[i].click();
      
      // Wait for the business details to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Extract business information
      const businessInfo = await extractBusinessInfo();
      
      if (businessInfo) {
        // Check if we already have a business with this URL in our queue
        if (businessInfo.website) {
          if (processedUrls.has(businessInfo.website)) {
            console.log(`Skipping duplicate URL: ${businessInfo.website}`);
            continue; // Skip adding this duplicate to the queue
          }
          
          // Add to our set of processed URLs
          processedUrls.add(businessInfo.website);
        }
        
        // Add to the website queue
        websiteQueue.push(businessInfo);
        console.log(`Added business to queue: ${businessInfo.businessName}, URL: ${businessInfo.website || 'No website'}`);
      }
      
      // Look for the back button with multiple possible selectors
      const backButtonSelectors = [
        'button[aria-label="Back"]',
        'button[jsaction*="back"]',
        'button.hYBOP',
        'button[aria-label="Back to results"]',
        'button[aria-label="Back to search results"]',
        'button[data-tooltip="Back"]',
        'button.VfPpkd-icon-button',
        'button.searchbox-button.searchbox-back'
      ];
      
      let backButton = null;
      for (const selector of backButtonSelectors) {
        backButton = document.querySelector(selector);
        if (backButton) break;
      }
      
      if (backButton) {
        backButton.click();
        await new Promise(resolve => setTimeout(resolve, 800));
      } else {
        console.warn('Back button not found, trying to navigate back via history');
        history.back();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error processing business:', error);
    }
  }
  
  // Log the number of businesses added to the queue
  console.log(`Added ${websiteQueue.length} businesses to the processing queue`);
  
  // Start processing websites
  processWebsiteQueue();
}

// Extract business information from the details panel
async function extractBusinessInfo() {
  try {
    // Initialize variables
    let businessName = 'Unknown Business';
    let website = '';
    let address = '';

    // Define list of terms to filter out
    const filterTerms = [
      'Sponsored', 'Gesponsert', 'Sponsorisé', 'Patrocinado', 'Sponsorizzato', '広告', 'Results',
      'Google Maps', 'Google', 'Maps', 'Google Maps App'
    ];

    // Wait for the business details panel to fully load
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('Extracting business information from details panel...');
    
    // First try to get the website URL
    const websiteSelectors = [
      'a[data-item-id="authority"]',
      'a[data-tooltip="Open website"]',
      '.section-info-line a[data-tooltip="Open website"]',
      'a[aria-label*="website" i]',
      'button[aria-label*="website" i] ~ a',
      '[data-section-id="action:website"] > a',
      'a[data-item-id^="authority"]',
      'a[jsaction*="Website" i]',
      'a.fontBodyMedium[target="_blank"][rel="noopener"]'
    ];
    
    // Find the website URL element
    let websiteElem = null;
    for (const selector of websiteSelectors) {
      websiteElem = document.querySelector(selector);
      if (websiteElem && websiteElem.href) {
        website = websiteElem.href;
        console.log('Found website URL:', website);
        break;
      }
    }
    
    // If we found a website element, look for the business name in the same container
    if (websiteElem) {
      // Try to find the main business details container that contains the website element
      let container = null;
      let element = websiteElem;
      const containerSelectors = ['.m6QErb', '.RcCsl', '.XltNde', '.aNGVpg', '.m6QErb-qJTHM-LgbsSe', '.lXJj5c'];
      
      // First try to find a direct ancestor that is a container
      for (let i = 0; i < 6; i++) { // Limit ancestor search depth
        if (!element || !element.parentElement) break;
        
        element = element.parentElement;
        
        // Check if this parent is one of our container types
        const isContainer = containerSelectors.some(selector => {
          return element.matches && element.matches(selector);
        });
        
        if (isContainer) {
          container = element;
          console.log('Found container containing website element');
          break;
        }
      }
      
      // If we didn't find a specific container, use the main details panel as container
      if (!container) {
        containerSelectors.forEach(selector => {
          if (!container) {
            container = document.querySelector(selector);
            if (container) {
              console.log('Using main details panel as container');
            }
          }
        });
      }
      
      // If we found a container, look for the business name within it
      if (container) {
        // First look for h1 elements within the container
        const headingSelectors = [
          'h1', 'h1.DUwDvf', 'h1.fontHeadlineLarge', 'div.fontHeadlineLarge',
          '[role="heading"][aria-level="1"]'
        ];
        
        for (const selector of headingSelectors) {
          const headingElement = container.querySelector(selector);
          if (headingElement) {
            const text = headingElement.textContent.trim();
            const isFilteredTerm = filterTerms.some(term => 
              text === term || text.includes(term)
            );
            
            if (text && text.length > 1 && !isFilteredTerm) {
              businessName = text;
              console.log('Found business name from heading in same container as website:', businessName);
              break;
            }
          }
        }
        
        // If we still don't have a business name, try to find it in any element with a role="heading"
        if (businessName === 'Unknown Business') {
          const roleHeadings = container.querySelectorAll('[role="heading"]');
          for (const heading of roleHeadings) {
            const text = heading.textContent.trim();
            const isFilteredTerm = filterTerms.some(term => 
              text === term || text.includes(term)
            );
            
            if (text && text.length > 1 && !isFilteredTerm) {
              businessName = text;
              console.log('Found business name from role="heading" in same container as website:', businessName);
              break;
            }
          }
        }
      }
    }
    
    // If we still don't have a business name, fall back to the main heading elements
    if (businessName === 'Unknown Business') {
      console.log('Could not find business name in same container as website, falling back to main heading...');
      
      // Try the main heading elements that typically contain the business name
      const mainHeadingSelectors = [
        'h1.DUwDvf', 
        'h1.fontHeadlineLarge', 
        '.x3AX1-LfntMc-header-title-title',
        '[role="main"] h1',
        'div.fontHeadlineLarge'
      ];
      
      for (const selector of mainHeadingSelectors) {
        const headingElement = document.querySelector(selector);
        if (headingElement) {
          const text = headingElement.textContent.trim();
          const isFilteredTerm = filterTerms.some(term => 
            text === term || text.includes(term)
          );
          
          if (text && text.length > 1 && !isFilteredTerm) {
            businessName = text;
            console.log('Found business name from main heading:', businessName);
            break;
          }
        }
      }
    }
    
    // If we still don't have a business name, try document title
    if (businessName === 'Unknown Business') {
      console.log('Trying to extract from document title...');
      const title = document.title;
      if (title) {
        // Remove "Google Maps" part
        const cleanTitle = title.replace(' - Google Maps', '')
                               .replace('Google Maps', '')
                               .trim();
                               
        const isFilteredTerm = filterTerms.some(term => 
          cleanTitle === term || 
          cleanTitle.includes(term)
        );
        
        if (cleanTitle && cleanTitle.length > 1 && !isFilteredTerm) {
          businessName = cleanTitle;
          console.log('Found business name from document title:', businessName);
        }
      }
    }
    
    // Remove any "Google Maps" text from the business name
    if (businessName.includes('Google Maps')) {
      businessName = businessName.replace('Google Maps', '').trim();
    }
    
    // Final validation
    if (businessName === 'Google' || businessName === 'Maps' || businessName === 'Google Maps' || 
        businessName === 'Sponsored' || businessName === 'Gesponsert' || businessName === 'Results' ||
        businessName.length < 2) {
      businessName = 'Unknown Business';
    }
    
    console.log('Final extracted business name:', businessName);
    
    // Get the address with more flexible selectors
    const addressSelectors = [
      'button[data-item-id="address"]',
      '[data-tooltip="Copy address"]',
      '.section-info-line [data-tooltip="Copy address"]',
      '[data-item-id^="address"]',
      'button[aria-label*="address" i]',
      'button[aria-label*="Address" i]',
      'button[aria-label*="location" i]',
      '[data-section-id="address"] button',
      '.fontBodyMedium span:first-child'
    ];
    
    for (const selector of addressSelectors) {
      const addressElem = document.querySelector(selector);
      if (addressElem) {
        address = addressElem.textContent.trim();
        break;
      }
    }
    
    // Clean the address from special characters
    if (address) {
      address = cleanAddress(address);
    }
    
    return {
      businessName,
      address,
      website
    };
  } catch (error) {
    console.error('Error extracting business info:', error);
    return null;
  }
}

// Helper function to clean addresses from special characters
function cleanAddress(address) {
  if (!address) return '';
  
  // Log original address for debugging
  console.log('Original address:', address);
  
  // Remove common special characters that might appear in addresses while preserving important ones
  let cleanedAddress = address
    // Replace multiple spaces with a single space
    .replace(/\s+/g, ' ')
    // Remove HTML entities and unicode special characters
    .replace(/&[a-zA-Z0-9#]+;/g, '')
    // Remove special characters except those commonly used in addresses
    .replace(/[^\w\s,.\-\/()#&+]/g, '')
    // Clean up any double commas, periods, or dashes
    .replace(/([,.,-])\1+/g, '$1')
    // Trim trailing/leading special characters
    .replace(/^[,.\s-]+|[,.\s-]+$/g, '')
    // Final trim to remove any spaces at beginning or end
    .trim();
  
  // Log cleaned address for debugging
  console.log('Cleaned address:', cleanedAddress);
  
  return cleanedAddress;
}

// Process the queue of websites to search for job listings
function processWebsiteQueue() {
  const totalWebsites = websiteQueue.length;
  
  if (totalWebsites === 0) {
    updatePopupProgress('No websites found to process', 50);
    finishSearch();
    return;
  }
  
  updatePopupProgress(`Starting to process ${totalWebsites} websites for job listings...`, 50);
  
  // Send message to background script to process websites
  chrome.runtime.sendMessage({
    action: 'processWebsites',
    data: {
      websites: websiteQueue,
      searchData: searchData
    }
  }, response => {
    if (chrome.runtime.lastError) {
      updatePopupProgress(`Error: ${chrome.runtime.lastError.message}`, 50);
      finishSearch();
    } else if (response && response.status === 'processing') {
      updatePopupProgress('Websites are being processed in the background...', 55);
    }
  });
}

// Utility function to wait for an element to appear in the DOM
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        reject(new Error(`Timeout waiting for element: ${selector}`));
        return;
      }
      
      setTimeout(checkElement, 100);
    };
    
    checkElement();
  });
}

// Utility function to wait for one of multiple possible elements to appear
function waitForElementWithOptions(selectors, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElements = () => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
      }
      
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        reject(new Error(`Timeout waiting for elements with selectors: ${selectors.join(', ')}`));
        return;
      }
      
      setTimeout(checkElements, 100);
    };
    
    checkElements();
  });
}

// Function to find the Google Maps search box with multiple possible selectors
async function findSearchBox() {
  // Try multiple selectors that might match the search box
  const possibleSelectors = [
    'input[aria-label="Search Google Maps"]',
    'input[placeholder="Search Google Maps"]',
    'input#searchboxinput',
    'input[name="q"]',
    'input.searchbox-input',
    '.searchbox input',
    'input[data-placeholder="Search Google Maps"]'
  ];
  
  // Try each selector
  for (const selector of possibleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  
  // If no selector worked, try to find any prominent input field
  const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const input of allInputs) {
    // Check if this might be a search box based on its attributes or position
    if (input.placeholder?.toLowerCase().includes('search') || 
        input.id?.toLowerCase().includes('search') || 
        input.className?.toLowerCase().includes('search')) {
      return input;
    }
  }
  
  // If still not found, wait a bit and retry with the first set of selectors
  // This helps when the page is still loading
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
      }
      reject(new Error("Could not find the Google Maps search box"));
    }, 2000);
  });
}

// Update the progress in the popup
function updatePopupProgress(status, progress) {
  chrome.runtime.sendMessage({
    action: 'updateProgress',
    status,
    progress
  });
}

// Calculate the overall progress
function calculateProgress() {
  if (!searchInProgress) return 0;
  
  if (websiteQueue.length === 0) {
    return 30; // Only collected business info, not processed websites
  }
  
  const processedWebsites = websiteQueue.filter(site => site.processed).length;
  const totalWebsites = websiteQueue.length;
  
  return 50 + (processedWebsites / totalWebsites) * 50;
}

// Finish the search process
function finishSearch() {
  searchInProgress = false;
  chrome.runtime.sendMessage({
    action: 'searchComplete'
  });
}

// Reset Google Maps to a clean state without refreshing the page
async function resetGoogleMapsState() {
  // Update progress to inform the user that reset is happening
  updatePopupProgress('Resetting Google Maps state...', 2);
  
  // Explicitly reset search state at the beginning of reset process
  searchInProgress = false;
  
  try {
    // Try to clear any active searches by clicking Google Maps logo (home button)
    const homeButtonSelectors = [
      'a[aria-label="Google Maps"]', 
      'a.google-maps-link', 
      'a[title="Google Maps"]',
      'a[href="https://www.google.com/maps"]',
      'a.searchbox-hamburger',
      'button.searchbox-button:first-child',
      'div.searchbox-hamburger-container',
      'div[jsaction*="logoclick"]'
    ];
    
    let homeButton = null;
    for (const selector of homeButtonSelectors) {
      homeButton = document.querySelector(selector);
      if (homeButton) break;
    }
    
    if (homeButton) {
      // Click the home button to return to the main Maps view
      homeButton.click();
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Try to clear the search box if it exists
    const searchBox = await findSearchBox().catch(() => null);
    if (searchBox) {
      // Clear the search box
      searchBox.value = '';
      searchBox.focus();
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Dispatch Escape key to close any autocomplete/suggestions
      document.dispatchEvent(new KeyboardEvent('keydown', { 
        key: 'Escape', 
        code: 'Escape', 
        keyCode: 27, 
        bubbles: true 
      }));
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Try to close any open panels or sidebar results
    const closeButtonSelectors = [
      'button[aria-label="Close"]',
      'button[jsaction*="close"]',
      'button.section-back-to-list-button',
      'button[data-tooltip="Close"]',
      'button.VfPpkd-icon-button',
      'button[aria-label="Back to results"]',
      'img.iRxY3GoUYUY__close',
      'button.searchbox-button.close-button'
    ];
    
    for (const selector of closeButtonSelectors) {
      const closeButtons = document.querySelectorAll(selector);
      if (closeButtons.length > 0) {
        for (const button of closeButtons) {
          button.click();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    
    // Reset all search-related variables to ensure clean state
    searchData = null;
    searchResults = [];
    currentResultIndex = 0;
    websiteQueue = [];
    
    // Wait a bit to ensure everything is fully reset
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Confirm the search box is available now
    const confirmedSearchBox = await findSearchBox().catch(() => null);
    if (!confirmedSearchBox) {
      throw new Error('Failed to find search box after reset');
    }
    
    updatePopupProgress('Google Maps reset complete', 5);
    return true;
  } catch (error) {
    console.error('Error resetting Google Maps state:', error);
    // Make sure we reset the searchInProgress flag even if an error occurs
    searchInProgress = false;
    throw error;
  }
}

// Cancel any ongoing search and reset the state
function cancelSearch() {
  console.log('Cancelling ongoing search');
  
  // Reset the search flag
  searchInProgress = false;
  
  // Reset other search-related variables
  searchData = null;
  searchResults = [];
  currentResultIndex = 0;
  websiteQueue = [];
  
  // Try to go back to the main Google Maps view to clean up any search state
  try {
    // Try to find the Google Maps home button and click it
    const homeButtonSelectors = [
      'a[aria-label="Google Maps"]', 
      'a.google-maps-link', 
      'a[title="Google Maps"]',
      'a[href="https://www.google.com/maps"]'
    ];
    
    for (const selector of homeButtonSelectors) {
      const homeButton = document.querySelector(selector);
      if (homeButton) {
        homeButton.click();
        break;
      }
    }
  } catch (e) {
    console.error('Error resetting Google Maps view:', e);
  }
}

// Initialize the content script
initialize();