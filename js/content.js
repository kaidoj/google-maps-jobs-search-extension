// Content script for Google Maps interactions
let searchData = null;
let searchInProgress = false;
let searchResults = [];
let currentResultIndex = 0;
let websiteQueue = [];

// Initialize when the page loads
function initialize() {
  console.log('Hidden Job Search Helper content script initialized');
  
  // Check if we need to restore state after a page refresh
  try {
    if (sessionStorage.getItem('gmjs_search_in_progress') === 'true') {
      console.log('Detected interrupted search, attempting to restore state');
      const storedQueue = sessionStorage.getItem('gmjs_websiteQueue');
      const storedSearchData = sessionStorage.getItem('gmjs_searchData');
      
      if (storedQueue && storedSearchData) {
        websiteQueue = JSON.parse(storedQueue);
        searchData = JSON.parse(storedSearchData);
        
        if (websiteQueue.length > 0) {
          // Clear the stored state to prevent infinite restore loops
          sessionStorage.removeItem('gmjs_search_in_progress');
          sessionStorage.removeItem('gmjs_websiteQueue');
          sessionStorage.removeItem('gmjs_searchData');
          sessionStorage.removeItem('gmjs_currentIndex');
          
          // Resume from website processing since we already have the queue
          console.log('Resuming search with recovered data');
          searchInProgress = true;
          setTimeout(() => {
            processWebsiteQueue();
          }, 1000);
        }
      }
    }
  } catch (e) {
    console.error('Error checking for saved search state:', e);
  }
  
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
  
  // Get the language from the URL to determine the search format
  const host = window.location.host;
  // Extract the language/country code from the domain (e.g., google.fr, google.de)
  const langMatch = host.match(/google\.([a-z.]+)$/i);
  let languageCode = langMatch ? langMatch[1] : 'com';
  
  // Check if it's a compound domain like co.uk
  if (languageCode && languageCode.includes('.')) {
    const parts = languageCode.split('.');
    // Take the last part as the country code (e.g., uk from co.uk)
    languageCode = parts[parts.length - 1];
  }
  
  console.log(`Detected language/country code: ${languageCode}`);
  
  // Set appropriate location phrase based on detected language
  let inLocationPhrase = ' in '; // Default English
  let inCurrentAreaPhrase = ' in current area'; // Default English
  
  // Define phrases for different languages
  const languagePhrases = {
    'fr': { inLocation: ' dans ', inCurrentArea: ' dans la zone actuelle' },
    'de': { inLocation: ' in ', inCurrentArea: ' im aktuellen Bereich' },
    'es': { inLocation: ' en ', inCurrentArea: ' en el área actual' },
    'it': { inLocation: ' a ', inCurrentArea: ' nell\'area corrente' },
    'pt': { inLocation: ' em ', inCurrentArea: ' na área atual' },
    'nl': { inLocation: ' in ', inCurrentArea: ' in huidige omgeving' },
    'ru': { inLocation: ' в ', inCurrentArea: ' в текущей области' },
    'ja': { inLocation: ' ', inCurrentArea: ' 現在のエリア' }, // Japanese often doesn't use prepositions
    'zh': { inLocation: ' ', inCurrentArea: ' 当前区域' }, // Chinese often doesn't use prepositions
    'ar': { inLocation: ' في ', inCurrentArea: ' في المنطقة الحالية' },
    'pl': { inLocation: ' w ', inCurrentArea: ' w obecnym obszarze' },
    'tr': { inLocation: ' ', inCurrentArea: ' mevcut bölgede' }, // Turkish uses suffixes instead of prepositions
    'ko': { inLocation: ' ', inCurrentArea: ' 현재 지역' } // Korean often doesn't use prepositions
  };
  
  // Map country codes to language codes if needed
  const countryToLanguage = {
    'uk': 'en', // United Kingdom -> English
    'au': 'en', // Australia -> English
    'ca': 'en', // Canada -> English (default, could be French too)
    'ie': 'en', // Ireland -> English
    'nz': 'en', // New Zealand -> English
    'za': 'en', // South Africa -> English
    'at': 'de', // Austria -> German
    'ch': 'de', // Switzerland -> German (default, could be French/Italian too)
    'be': 'fr', // Belgium -> French (default, could be Dutch too)
    'br': 'pt', // Brazil -> Portuguese
    'mx': 'es', // Mexico -> Spanish
    'ar': 'es', // Argentina -> Spanish
    'cl': 'es', // Chile -> Spanish
    'co': 'es'  // Colombia -> Spanish
  };
  
  // Get language code from country code if we have a mapping
  const mappedLanguage = countryToLanguage[languageCode.toLowerCase()];
  if (mappedLanguage) {
    languageCode = mappedLanguage;
  }
  
  // Get phrases for the detected language or fall back to English
  const phrases = languagePhrases[languageCode.toLowerCase()] || { inLocation: ' in ', inCurrentArea: ' in current area' };
  inLocationPhrase = phrases.inLocation;
  inCurrentAreaPhrase = phrases.inCurrentArea;
  
  // Add appropriate location to query using the language-specific phrase
  if (!searchData.location || searchData.location.trim() === '') {
    // If no location specified, use language-specific "in current area" phrase
    query += inCurrentAreaPhrase;
  } else {
    // If location is specified, use language-specific "in [location]" phrase
    query += `${inLocationPhrase}${searchData.location.trim()}`;
  }
  
  console.log(`Search query in ${languageCode}: ${query}`);
  
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
    
    // Track how many items we need to get in order to achieve the required non-cached results
    // Start with the max limit, but this may increase if we find cached items
    let targetResultCount = maxResults;
    
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
    
    // Instead of limiting right away, we'll keep scrolling to get more results
    // than our target in case some are in cache
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS && resultItems.length < targetResultCount + 10) {
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
    
    // Note: We don't limit the results here as we might need more depending on how many are in cache
    // We'll process all the found results, and let the processResultItems function handle the limit
    
    updatePopupProgress(`Found ${resultItems.length} businesses. Processing...`, 25);
    
    // Process each result item to get business info and handle the max result limit dynamically
    await processResultItems(resultItems, maxResults);
    
  } catch (error) {
    updatePopupProgress(`Error collecting search results: ${error.message}`, 0);
    searchInProgress = false;
  }
}

// Process each result item to extract business information
async function processResultItems(resultItems, maxResults) {
  updatePopupProgress(`Processing ${resultItems.length} businesses...`, 30);
  
  // Set to track URLs we've already processed to avoid duplicates
  const processedUrls = new Set();
  
  // Counter for new websites (websites requiring fresh processing)
  let freshWebsiteCount = 0;
  // Counter for skipped previously visited websites
  let skippedPreviouslyVisitedCount = 0;
  
  for (let i = 0; i < resultItems.length; i++) {
    // If we've reached our target of fresh sites, stop processing
    if (freshWebsiteCount >= maxResults) {
      console.log(`Reached target of ${maxResults} new websites. Stopping processing.`);
      break;
    }
    
    const progress = 30 + (i / resultItems.length) * 20;
    updatePopupProgress(`Processing business ${i+1}/${resultItems.length} (${freshWebsiteCount} collected, ${skippedPreviouslyVisitedCount} skipped)...`, progress);
    
    try {
      // Store current URL and document title before clicking
      const originalUrl = window.location.href;
      const originalTitle = document.title;
      
      console.log(`Processing business ${i+1}: About to click result`);
      
      // IMPORTANT: Use a more controlled approach to open business details
      // Instead of directly clicking the element (which might navigate to a new URL)
      // We'll try to use Google Maps internal navigation mechanisms
      
      // 1. First try - use event listeners to intercept default navigation
      let clickHandled = false;
      const preventNavigation = (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log('Prevented default navigation behavior');
        clickHandled = true;
      };
      
      // Add temporary event listeners to prevent navigation
      window.addEventListener('beforeunload', preventNavigation, true);
      
      // Check if this is a place link we can parse
      const placeLink = resultItems[i].getAttribute('href') || '';
      if (placeLink.includes('/maps/place/')) {
        // Parse place ID from the URL if possible
        try {
          const placeIdMatch = placeLink.match(/!1s([^!]+)/);
          if (placeIdMatch && placeIdMatch[1]) {
            const placeId = placeIdMatch[1];
            console.log(`Found place ID: ${placeId}, using alternative navigation method`);
            
            // Try to find the place card without navigating
            resultItems[i].focus();
            
            // Simulate click but on mousedown/mouseup instead of click event
            resultItems[i].dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
            resultItems[i].dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
            
            // Instead of click, which might cause navigation
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (e) {
          console.error('Error parsing place ID:', e);
        }
      }
      
      // If we couldn't handle it with place ID, try normal click but carefully
      if (!clickHandled) {
        console.log('Using standard click with navigation safeguards');
        // Click the result directly, while still preventing page reload
        resultItems[i].click();
      }
      
      // Remove the navigation prevention handler
      window.removeEventListener('beforeunload', preventNavigation, true);
      
      // Wait for the business details to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if we navigated to a new page unexpectedly
      const urlChanged = window.location.href !== originalUrl;
      const titleChanged = document.title !== originalTitle;
      
      if (urlChanged) {
        console.warn(`URL changed unexpectedly: ${originalUrl} → ${window.location.href}`);
        
        // Save state in case we need to recover
        sessionStorage.setItem('gmjs_search_in_progress', 'true');
        sessionStorage.setItem('gmjs_websiteQueue', JSON.stringify(websiteQueue));
        sessionStorage.setItem('gmjs_searchData', JSON.stringify(searchData));
        sessionStorage.setItem('gmjs_currentIndex', i.toString());
      }
      
      // Extract business information even if URL changed
      const businessInfo = await extractBusinessInfo();
      
      if (businessInfo) {
        // Check if we already have a business with this URL in our queue
        if (businessInfo.website) {
          // Skip duplicate websites in the current queue
          if (processedUrls.has(businessInfo.website)) {
            console.log(`Skipping duplicate URL: ${businessInfo.website}`);
            continue; // Skip adding this duplicate to the queue
          }
          
          // Check if this website was previously visited
          const wasVisitedBefore = await checkUrlInPreviouslyVisited(businessInfo.website);
          if (wasVisitedBefore) {
            console.log(`Skipping ${businessInfo.businessName} - already visited before`);
            // Increment the skipped previously visited counter
            skippedPreviouslyVisitedCount++;
            // Don't add to websiteQueue - we're completely skipping previously visited websites
            
            // Add to our set of processed URLs to avoid duplicates
            processedUrls.add(businessInfo.website);
            
            // Continue to the next business without clicking back
            continue;
          }
          
          // Add to our set of processed URLs
          processedUrls.add(businessInfo.website);
          
          // Increment our count of fresh websites
          freshWebsiteCount++;
        } else {
          // Website without a URL is always considered fresh
          freshWebsiteCount++;
        }
        
        // Add to the website queue
        websiteQueue.push(businessInfo);
        console.log(`Added new business to queue: ${businessInfo.businessName}, URL: ${businessInfo.website || 'No website'}`);
      }
      
      // Navigate back based on multiple strategies
      let navigatedBack = false;
      
      // If the URL changed (full page navigation happened)
      if (urlChanged) {
        // Try to restore the original URL using pushState
        try {
          console.log('Attempting to restore original URL using pushState');
          window.history.pushState({}, '', originalUrl);
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Check if we're back to search results
          const resultsVisible = !!(document.querySelector('div[role="feed"]') || 
                                   document.querySelector('div[role="list"]'));
          
          if (resultsVisible) {
            console.log('Successfully restored to search results via pushState');
            navigatedBack = true;
          } else {
            // If pushState didn't get us back to results, use history.back() cautiously
            console.log('pushState didn\'t restore results view, trying history.back()');
            history.back();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check again if we have results
            const resultsVisibleAfterBack = !!(document.querySelector('div[role="feed"]') || 
                                             document.querySelector('div[role="list"]'));
            
            if (resultsVisibleAfterBack) {
              console.log('Successfully navigated back via history.back()');
              navigatedBack = true;
            }
          }
        } catch (e) {
          console.error('Error navigating with history:', e);
        }
      } else {
        // URL didn't change, so we're dealing with a panel overlay
        // Try closing the panel instead of navigating back
        
        // 1. Try different selectors for back buttons
        const backButtonSelectors = [
          'button[aria-label="Back"]',
          'button[jsaction*="back"]',
          'button.hYBOP',
          'button[aria-label="Back to results"]',
          'button[aria-label="Back to search results"]',
          'button[data-tooltip="Back"]',
          'button.VfPpkd-icon-button',
          'button.searchbox-button.searchbox-back',
          'button[jsaction*="backclick"]',
          'button.DVeyrd',
          'button[data-tooltip*="back" i]',
          'button[jsaction="pane.backButtonClicked"]'
        ];
        
        for (const selector of backButtonSelectors) {
          const backButton = document.querySelector(selector);
          if (backButton) {
            console.log(`Found back button with selector: ${selector}`);
            backButton.click();
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // Check if we successfully navigated back by checking if results list is visible
            if (document.querySelector('div[role="feed"]') || document.querySelector('div[role="list"]')) {
              navigatedBack = true;
              console.log('Successfully navigated back via back button');
              break;
            }
          }
        }
        
        // 2. If back button didn't work, try closing the panel
        if (!navigatedBack) {
          const closeButtonSelectors = [
            'button[aria-label="Close"]',
            'button[jsaction*="close"]',
            'button[data-tooltip="Close"]',
            'img.iRxY3GoUYUY__close',
            'button[jsaction="pane.dismiss"]',
            '.IPwzOs-icon-common[aria-label="Close"]',
            'button.VfPpkd-icon-button[data-tooltip="Close"]'
          ];
          
          for (const selector of closeButtonSelectors) {
            const closeButton = document.querySelector(selector);
            if (closeButton) {
              console.log(`Found close button with selector: ${selector}`);
              closeButton.click();
              await new Promise(resolve => setTimeout(resolve, 800));
              
              // Check if we successfully navigated back
              if (document.querySelector('div[role="feed"]') || document.querySelector('div[role="list"]')) {
                navigatedBack = true;
                console.log('Successfully navigated back via close button');
                break;
              }
            }
          }
        }
      }
      
      // If we still haven't navigated back successfully, look for the results feed
      if (!navigatedBack) {
        const resultsFeed = document.querySelector('div[role="feed"]') || document.querySelector('div[role="list"]');
        if (resultsFeed) {
          console.log('Found results feed without navigation, continuing...');
          navigatedBack = true;
        } else {
          console.warn('Failed to return to results view. Trying to recover...');
          
          // Try the Google Maps logo as a last resort
          const homeButtons = document.querySelectorAll('a[aria-label="Google Maps"], a.google-maps-link');
          if (homeButtons.length > 0) {
            console.log('Clicking Google Maps logo to reset view');
            homeButtons[0].click();
            await new Promise(resolve => setTimeout(resolve, 1200));
            
            // If we clicked home, we need to re-execute the search
            if (searchData) {
              console.log('Re-executing search after clicking home button');
              startBusinessSearch();
              
              // Wait for search to complete and results to load
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Indicate that this iteration failed but we're continuing
              console.log('Search re-executed, but this business was skipped');
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing business:', error);
    }
  }
  
  // Log the final counts
  console.log(`Added ${websiteQueue.length} new businesses to the processing queue (skipped ${skippedPreviouslyVisitedCount} previously visited businesses)`);
  
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
  
  // Send message to background script to cancel any ongoing processes
  chrome.runtime.sendMessage({
    action: 'cancelSearch'
  }, response => {
    console.log('Background script notified of search cancellation:', response);
  });
  
  // Clear any stored search state from session storage
  try {
    sessionStorage.removeItem('gmjs_search_in_progress');
    sessionStorage.removeItem('gmjs_websiteQueue');
    sessionStorage.removeItem('gmjs_searchData');
    sessionStorage.removeItem('gmjs_currentIndex');
  } catch (e) {
    console.error('Error clearing session storage:', e);
  }
  
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
  
  // Update progress to inform user that search was cancelled
  updatePopupProgress('Search cancelled', 0);
}

// Initialize the content script
initialize();

// Function to check if a URL was previously visited and saved
async function checkUrlInPreviouslyVisited(url) {
  return new Promise((resolve) => {
    // First check if saving previously visited sites is enabled
    chrome.storage.local.get(['enableCache', 'cacheTime'], function(settings) {
      const savePreviouslyVisited = settings.enableCache !== false; // Default to true if not set
      
      // If saving previously visited sites is disabled, resolve with null
      if (!savePreviouslyVisited) {
        resolve(null);
        return;
      }
      
      const rememberDays = settings.cacheTime || 30; // Default to 30 days if not set
      const dataKey = 'cached_' + btoa(url); // Base64 encode the URL as the key
      
      // Check for saved data
      chrome.storage.local.get([dataKey], function(data) {
        if (data[dataKey]) {
          const savedData = data[dataKey];
          const now = new Date().getTime();
          const expirationTime = savedData.timestamp + (rememberDays * 24 * 60 * 60 * 1000); // Convert days to milliseconds
          
          // Check if saved data is still valid
          if (now < expirationTime) {
            // Data is valid, return it
            resolve(savedData.data);
          } else {
            // Data is expired, remove it
            chrome.storage.local.remove([dataKey], function() {
              console.log('Removed expired saved data for:', url);
              resolve(null);
            });
          }
        } else {
          // No saved data found
          resolve(null);
        }
      });
    });
  });
}