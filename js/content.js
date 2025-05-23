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
    // First check if search was already completed
    const searchCompleted = sessionStorage.getItem('gmjs_searchCompleted') === 'true';
    
    // If search was completed, don't attempt to resume it on page refresh
    if (searchCompleted) {
      console.log('Previous search was completed, no need to restore');
      
      // Make sure searchInProgress is false to prevent any new search tasks
      searchInProgress = false;
      
      // Keep the completed flag but clear any in-progress flags and website queue
      sessionStorage.removeItem('gmjs_search_in_progress');
      sessionStorage.removeItem('gmjs_websiteQueue');
      sessionStorage.removeItem('gmjs_searchData');
      sessionStorage.removeItem('gmjs_currentIndex');
      
      // Also ensure the websiteQueue is cleared in memory
      websiteQueue = [];
      return;
    }
    
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
          
          // Resume the search after a small delay
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
      
      // Check if there's a completed search state when popup reopens
      const searchCompleted = sessionStorage.getItem('gmjs_searchCompleted') === 'true';
      
      // Check if search is in progress according to session storage
      const searchInProgressFromStorage = sessionStorage.getItem('gmjs_search_in_progress') === 'true';
      
      // If either memory or session storage indicates a search is in progress, report it as in progress
      const isActuallyInProgress = searchInProgress || searchInProgressFromStorage;
      
      // If storage indicates search is in progress but memory says no, synchronize them
      if (isActuallyInProgress && !searchInProgress) {
          console.log('Search is marked as in progress in session storage but not in memory. Synchronizing state.');
          searchInProgress = true;
          
          // Retrieve the search data if available
          try {
              const storedData = sessionStorage.getItem('gmjs_searchData');
              if (storedData) {
                  searchData = JSON.parse(storedData);
              }
              
              // Ensure session storage flag is set to match our memory state
              sessionStorage.setItem('gmjs_search_in_progress', 'true');
          } catch (e) {
              console.error('Error parsing stored search data:', e);
          }
      }
      
      // If memory indicates search is in progress but storage says no, synchronize them
      if (searchInProgress && !searchInProgressFromStorage) {
          try {
              console.log('Search is in progress in memory but not in storage. Synchronizing state.');
              sessionStorage.setItem('gmjs_search_in_progress', 'true');
              if (searchData) {
                  sessionStorage.setItem('gmjs_searchData', JSON.stringify(searchData));
              }
          } catch (e) {
              console.error('Error setting search state in session storage:', e);
          }
      }
      
      // Check if we have final results in session storage to include in the response
      let finalResults = null;
      let searchCompletedTimestamp = null;
      
      try {
        // Get the completed timestamp
        const timestampStr = sessionStorage.getItem('gmjs_searchCompletedTimestamp');
        if (timestampStr) {
          searchCompletedTimestamp = parseInt(timestampStr);
        }
        
        // Get final results if available
        const finalResultsStr = sessionStorage.getItem('gmjs_finalResults');
        if (finalResultsStr) {
          finalResults = JSON.parse(finalResultsStr);
          console.log(`Found ${finalResults.length} stored final results to include in popup response`);
        }
      } catch (e) {
        console.error('Error retrieving final results from session storage:', e);
      }
      
      // Include the searchCompleted flag and final results in the response
      sendResponse({ 
        inProgress: isActuallyInProgress,
        searchCompleted: searchCompleted,
        finalResults: finalResults,
        searchCompletedTimestamp: searchCompletedTimestamp,
        status: sessionStorage.getItem('gmjs_contentStatus'),
        progress: sessionStorage.getItem('gmjs_contentProgress')
      });
      return true; // Keep messaging channel open for async operations
    } else if (message.action === 'updateResult') {
      // Handle updates to search results (e.g. after external web search completes)
      console.log('Received updateResult for website:', message.result?.website);
      
      try {
        // Ensure jobSpecificKeywords is always an array in the received message
        if (!message.result.jobSpecificKeywords) {
          console.log(`No jobSpecificKeywords in received result for ${message.result.website}, using empty array`);
          message.result.jobSpecificKeywords = [];
        } else {
          console.log(`Received ${message.result.jobSpecificKeywords.length} jobSpecificKeywords for ${message.result.website}: ${message.result.jobSpecificKeywords.join(', ')}`);
        }
        
        // Update the final results in session storage
        const finalResultsStr = sessionStorage.getItem('gmjs_finalResults');
        if (finalResultsStr) {
          const finalResults = JSON.parse(finalResultsStr);
          if (Array.isArray(finalResults) && finalResults.length > 0) {
            // Find and update the specific result
            const resultIndex = finalResults.findIndex(result => result.website === message.result.website);
            if (resultIndex !== -1) {
              // Update the result in our array
              finalResults[resultIndex] = message.result;
              console.log(`Updated result for ${message.result.website} in session storage`);
              
              // Save the updated array back to session storage
              sessionStorage.setItem('gmjs_finalResults', JSON.stringify(finalResults));
              
              // Also save a timestamp of when the results were last updated
              sessionStorage.setItem('gmjs_searchCompletedTimestamp', Date.now().toString());
            } else {
              console.log(`Result for ${message.result.website} not found in session storage`);
            }
          }
        } else {
          console.log('No finalResults found in session storage to update');
        }
      } catch (e) {
        console.error('Error updating result in session storage:', e);
      }
      
      sendResponse({ status: 'result_updated' });
      return true; // Keep messaging channel open
    }
    
    // Default return for any other messages
    return false;
  });
  
  // Set up a connection listener to detect when the popup closes
  chrome.runtime.onConnect.addListener(port => {
    console.log('Popup connected');
    
    // Listen for popup disconnect
    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected, but not canceling search automatically');
      
      // Check runtime.lastError to suppress any errors
      if (chrome.runtime.lastError) {
        console.error('Error on disconnect:', chrome.runtime.lastError);
      }
      
      // Instead of immediately cancelling the search when popup closes,
      // we'll check with the background script to see if we should continue
      setTimeout(() => {
        // We communicate with the background script instead of checking popup directly
        chrome.runtime.sendMessage({ action: 'checkSearchStatus' }, response => {
          // Only cancel if we get a specific instruction to cancel
          if (response && response.shouldCancel) {
            console.log('Background script indicates search should be cancelled');
            cancelSearch();
          } else {
            console.log('Search will continue running in the background');
          }
        });
      }, 1000); // Wait 1 second before checking
    });
  });
}

// Start the search process on Google Maps
function startMapsSearch(data) {
  searchData = data;
  searchResults = [];
  currentResultIndex = 0;
  websiteQueue = [];
  
  // Set search in progress flag in session storage
  try {
    // First make absolutely sure we remove any completed flag
    sessionStorage.removeItem('gmjs_searchCompleted');
    
    // Set both the in progress flag and search data
    sessionStorage.setItem('gmjs_search_in_progress', 'true');
    sessionStorage.setItem('gmjs_searchData', JSON.stringify(data));
    console.log('Set gmjs_search_in_progress to true in session storage');
    
    // Clear any previous status/progress
    sessionStorage.removeItem('gmjs_contentProgress');
    sessionStorage.removeItem('gmjs_contentStatus');
    
    // Clear any previous website queue and current index
    sessionStorage.removeItem('gmjs_websiteQueue');
    sessionStorage.removeItem('gmjs_currentIndex');
  } catch (e) {
    console.error('Error saving search state to session storage:', e);
  }
  
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
    'fr': { inLocation: ' à ', inCurrentArea: ' dans la région actuelle' },
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
    'ko': { inLocation: ' ', inCurrentArea: ' 현재 지역' }, // Korean often doesn't use prepositions
    'sv': { inLocation: ' i ', inCurrentArea: ' i nuvarande område' }, // Swedish
    'da': { inLocation: ' i ', inCurrentArea: ' i nuværende område' }, // Danish
    'no': { inLocation: ' i ', inCurrentArea: ' i nåværende område' }, // Norwegian
    'fi': { inLocation: ' ', inCurrentArea: ' nykyisellä alueella' }, // Finnish uses cases not prepositions
    'el': { inLocation: ' σε ', inCurrentArea: ' στην τρέχουσα περιοχή' }, // Greek
    'cs': { inLocation: ' v ', inCurrentArea: ' v aktuální oblasti' }, // Czech
    'hu': { inLocation: ' ', inCurrentArea: ' a jelenlegi területen' }, // Hungarian uses cases
    'ro': { inLocation: ' în ', inCurrentArea: ' în zona curentă' }, // Romanian
    'bg': { inLocation: ' в ', inCurrentArea: ' в текущата област' }, // Bulgarian
    'uk': { inLocation: ' в ', inCurrentArea: ' в поточній області' }, // Ukrainian
    'hr': { inLocation: ' u ', inCurrentArea: ' u trenutnom području' }, // Croatian
    'th': { inLocation: ' ใน ', inCurrentArea: ' ในพื้นที่ปัจจุบัน' }, // Thai
    'id': { inLocation: ' di ', inCurrentArea: ' di area saat ini' }, // Indonesian
    'vi': { inLocation: ' tại ', inCurrentArea: ' trong khu vực hiện tại' } // Vietnamese
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
    'co': 'es', // Colombia -> Spanish
    'pe': 'es', // Peru -> Spanish
    've': 'es', // Venezuela -> Spanish
    'dk': 'da', // Denmark -> Danish
    'se': 'sv', // Sweden -> Swedish
    'no': 'no', // Norway -> Norwegian
    'fi': 'fi', // Finland -> Finnish
    'gr': 'el', // Greece -> Greek
    'cz': 'cs', // Czech Republic -> Czech
    'hu': 'hu', // Hungary -> Hungarian
    'ro': 'ro', // Romania -> Romanian
    'bg': 'bg', // Bulgaria -> Bulgarian
    'ua': 'uk', // Ukraine -> Ukrainian
    'hr': 'hr', // Croatia -> Croatian
    'th': 'th', // Thailand -> Thai
    'id': 'id', // Indonesia -> Indonesian
    'vn': 'vi', // Vietnam -> Vietnamese
    'sg': 'en', // Singapore -> English (default, could be many others)
    'ph': 'en', // Philippines -> English (default)
    'my': 'en', // Malaysia -> English (default)
    'in': 'en'  // India -> English (default)
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
  
  // Special handling for French Google Maps
  if (languageCode.toLowerCase() === 'fr') {
    console.log('Using enhanced query format for French Google Maps');

    if (!searchData.location || searchData.location.trim() === '') {
      // For current area in French, we use "dans la région actuelle"
      query += inCurrentAreaPhrase;
    } else {
      // For specific locations in French, we use "à [location]"
      query += `${inLocationPhrase}${searchData.location.trim()}`;
    }
  } else {
    // Standard approach for other languages
    if (!searchData.location || searchData.location.trim() === '') {
      query += inCurrentAreaPhrase;
    } else {
      query += `${inLocationPhrase}${searchData.location.trim()}`;
    }
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
  
  // Try different selectors for the results feed with fallbacks - expanded for google.fr
  try {
    const resultsFeed = await waitForElementWithOptions([
      'div[role="feed"]', 
      'div[role="list"]',
      '.section-result-content',
      '.section-scrollbox',
      '.lXJj5c',
      'div.m6QErb[aria-label]',
      'div[jsaction*="pane.resultspanel"]',
      '.m6QErb div[role="region"]',
      // Add more specific selectors for google.fr
      'div.m6QErb',
      'div.m6QErb div[role="region"]',
      'div[jsaction*="mouseover"]',
      'div[jsaction*="resultspanel"]',
      // Broader fallback selectors
      '.section-layout .section-scrollbox',
      'div[data-test-id="result-list"]',
      'div.section-layout.section-scrollbox'
    ], 8000);
    
    // Set the maximum number of scrolls to try (prevent infinite scrolling)
    const MAX_SCROLL_ATTEMPTS = 15;
    let scrollAttempts = 0;
    let prevResultCount = 0;
    let resultItems = [];
    
    // Get the max results limit from searchData
    const maxResults = searchData.maxResults || 20;
    console.log(`Max results limit: ${maxResults}`);
    
    // Enhanced function to get all result items from the feed with more robust selectors
    function getResultItems(feed) {
      // Try different selectors to find result items - enhanced for google.fr and other domains
      let items = feed.querySelectorAll('div[role="article"]');
      
      // Try alternative selectors if the first one didn't work
      if (items.length === 0) {
        items = feed.querySelectorAll('a[href^="https://www.google.com/maps/place"]');
      }
      
      // Try localized Google Maps URLs (for france and other countries)
      if (items.length === 0) {
        items = feed.querySelectorAll('a[href*="/maps/place"]');
      }
      
      // Look for clickable items with specific attributes
      if (items.length === 0) {
        items = feed.querySelectorAll('div[jsaction*="mousedown:place"]');
      }
      
      // Look for elements with specific Google Maps classes
      if (items.length === 0) {
        items = feed.querySelectorAll('div.Nv2PK, div.bfdHYd, div.uMGCkf');
      }
      
      // Look for result items with data-item-id
      if (items.length === 0) {
        items = feed.querySelectorAll('div[data-item-id]');
      }
      
      // Final fallback - try to find anything that looks like a result card
      if (items.length === 0) {
        items = feed.querySelectorAll('div[jsaction*="mouseover"], div[tabindex="0"][jsaction]');
      }
      
      console.log(`Found ${items.length} potential result items using enhanced selectors`);
      return Array.from(items);
    }
    
    // Initialize tracking variables for fresh vs cached results
    let processedItems = [];
    let freshWebsiteCount = 0;
    let skippedPreviouslyVisitedCount = 0;
    let processedUrls = new Set();
    
    // Initial set of results
    resultItems = getResultItems(resultsFeed);
    
    // If no results found initially, stop the search
    if (resultItems.length === 0) {
      updatePopupProgress('No businesses found in the current map view. Try adjusting your search.', 0);
      searchInProgress = false;
      return;
    }
    
    // Log initial results count
    prevResultCount = resultItems.length;
    console.log(`Initially found ${prevResultCount} business results`);

    // This is our main scrolling loop - we'll keep scrolling until we either:
    // 1. Get enough fresh results
    // 2. Reach the maximum scroll attempts
    // 3. Detect we're at the end of available results
    while (scrollAttempts < MAX_SCROLL_ATTEMPTS && freshWebsiteCount < maxResults) {
      // Process current batch of items that haven't been processed yet
      let startIndex = processedItems.length;
      
      // Only process new items that haven't been processed yet
      for (let i = startIndex; i < resultItems.length; i++) {
        if (freshWebsiteCount >= maxResults) {
          break;
        }
        
        // Mark this item as processed
        processedItems.push(resultItems[i]);
        
        const progress = 20 + ((processedItems.length / (resultItems.length + 10)) * 10);
        updatePopupProgress(`Processing business ${processedItems.length}/${resultItems.length} (${freshWebsiteCount} collected)...`, progress);
        
        // Process the business item (click, extract info, etc)
        try {
          const businessInfo = await processBusinessItem(resultItems[i]);
          
          // If we got valid business info
          if (businessInfo) {
            // Check if we already have this website in our queue or processed it
            if (businessInfo.website) {
              // Skip duplicate websites
              if (processedUrls.has(businessInfo.website)) {
                console.log(`Skipping duplicate URL: ${businessInfo.website}`);
                continue;
              }
              
              // Check if this website was previously visited/cached
              const wasVisitedBefore = await checkUrlInPreviouslyVisited(businessInfo.website);
              if (wasVisitedBefore) {
                console.log(`Skipping ${businessInfo.businessName} - already visited before`);
                skippedPreviouslyVisitedCount++;
                processedUrls.add(businessInfo.website);
                continue;
              }
              
              // Add to processed URLs set
              processedUrls.add(businessInfo.website);
              
              // Increment fresh website count
              freshWebsiteCount++;
            } else {
              // Website without a URL is always considered fresh
              freshWebsiteCount++;
            }
            
            // Add to the website queue
            websiteQueue.push(businessInfo);
            console.log(`Added new business to queue: ${businessInfo.businessName}, Website: ${businessInfo.website || 'No website'}`);
          }
        } catch (error) {
          console.error('Error processing business:', error);
        }
      }
      
      // Update progress info
      console.log(`Progress: ${freshWebsiteCount}/${maxResults} fresh websites found, ${skippedPreviouslyVisitedCount} skipped (cached)`);
      
      // Check if we've found enough fresh results
      if (freshWebsiteCount >= maxResults) {
        console.log(`Reached target of ${maxResults} fresh websites. Stopping collection.`);
        break;
      }
      
      // If we haven't reached our target, scroll to get more results
      updatePopupProgress(`Found ${freshWebsiteCount}/${maxResults} fresh websites. Scrolling to load more results...`, 25);
      
      // Scroll down to load more results
      resultsFeed.scrollTo({
        top: resultsFeed.scrollHeight,
        behavior: 'smooth'
      });
      
      // Wait for potential new results to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Get updated list of results
      const newResultItems = getResultItems(resultsFeed);
      
      // If we didn't get any new results after scrolling
      if (newResultItems.length <= resultItems.length) {
        scrollAttempts++;
        
        // If we've tried multiple times with no new results, we're likely at the end
        if (scrollAttempts >= 3 && newResultItems.length === resultItems.length) {
          console.log(`No new results after ${scrollAttempts} scroll attempts, likely reached the end`);
          break;
        }
      } else {
        // We got new results, reset scroll attempts counter
        scrollAttempts = 0;
        console.log(`Found ${newResultItems.length - resultItems.length} new results (total: ${newResultItems.length})`);
        
        // Update our results array with the new items
        resultItems = newResultItems;
      }
    }
    
    // Log final counts
    updatePopupProgress(`Finished collecting ${freshWebsiteCount} businesses (${skippedPreviouslyVisitedCount} skipped from cache)`, 30);
    
    // If we didn't find enough fresh results but exhausted all available results
    if (freshWebsiteCount < maxResults) {
      console.log(`Could only find ${freshWebsiteCount} fresh results out of target ${maxResults}`);
    }
    
    // Start processing websites
    processWebsiteQueue();
    
  } catch (error) {
    updatePopupProgress(`Error collecting search results: ${error.message}`, 0);
    searchInProgress = false;
  }
}

// Function to process a single business item from the results list
async function processBusinessItem(resultItem) {
  try {
    console.log('Processing business item:', resultItem);
    
    // Store current URL and document title before clicking
    const originalUrl = window.location.href;
    const originalTitle = document.title;
    
    // Enhanced approach for Google Maps - first try to determine if this is an interactive element
    const isClickable = resultItem.hasAttribute('jsaction') || 
                       resultItem.hasAttribute('role') || 
                       resultItem.tagName === 'A' ||
                       resultItem.querySelector('a') !== null;
                       
    console.log(`Element appears to be clickable: ${isClickable}`);
    
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
    const placeLink = resultItem.getAttribute('href') || resultItem.querySelector('a')?.getAttribute('href') || '';
    if (placeLink.includes('/maps/place/')) {
      // Parse place ID from the URL if possible
      try {
        const placeIdMatch = placeLink.match(/!1s([^!]+)/) || placeLink.match(/place\/([^\/]+)/);
        if (placeIdMatch && placeIdMatch[1]) {
          const placeId = placeIdMatch[1];
          console.log(`Found place ID: ${placeId}, using alternative navigation method`);
          
          // Try to find the place card without navigating
          resultItem.focus();
          
          // Simulate click but on mousedown/mouseup instead of click event
          resultItem.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
          resultItem.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
          
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
      
      // For non-anchor elements, try to find and click any anchor inside
      const anchor = resultItem.tagName === 'A' ? resultItem : resultItem.querySelector('a');
      
      if (anchor) {
        console.log('Found anchor element to click');
        anchor.click();
      } else {
        // If no anchor found, click the original element
        resultItem.click();
      }
    }
    
    // Remove the navigation prevention handler
    window.removeEventListener('beforeunload', preventNavigation, true);
    
    // Wait for the business details to load - increased timeout for google.fr
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if we navigated to a new page unexpectedly
    const urlChanged = window.location.href !== originalUrl;
    const titleChanged = document.title !== originalTitle;
    
    if (urlChanged) {
      console.warn(`URL changed unexpectedly: ${originalUrl} → ${window.location.href}`);
      
      // Save state in case we need to recover
      sessionStorage.setItem('gmjs_search_in_progress', 'true');
      sessionStorage.setItem('gmjs_websiteQueue', JSON.stringify(websiteQueue));
      sessionStorage.setItem('gmjs_searchData', JSON.stringify(searchData));
    }
    
    // Extract business information even if URL changed
    const businessInfo = await extractBusinessInfo();
    
    // Log business details found
    if (businessInfo) {
      console.log(`Extracted business info: Name=${businessInfo.businessName}, Website=${businessInfo.website || 'none'}`);
    } else {
      console.warn('Failed to extract business information');
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
    
    return businessInfo;
  } catch (error) {
    console.error('Error processing business item:', error);
    return null;
  }
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
        
        // Check if this ancestor matches any of our container selectors
        if (containerSelectors.some(selector => element.matches(selector))) {
          container = element;
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

// Process each result item to extract business information
async function processResultItems(resultItems, maxResults) {
  updatePopupProgress(`Processing ${resultItems.length} businesses...`, 30);
  
  // Set to track URLs we've already processed to avoid duplicates
  const processedUrls = new Set();
  
  // Counter for new websites (websites requiring fresh processing)
  let freshWebsiteCount = 0;
  
  // Process each result item
  for (const item of resultItems) {
    // Extract business information
    const businessInfo = await extractBusinessInfo(item);
    
    // If we got valid business info
    if (businessInfo && businessInfo.website) {
      // Check if we already processed this URL
      if (!processedUrls.has(businessInfo.website)) {
        // Add to processed URLs set
        processedUrls.add(businessInfo.website);
        
        // Increment fresh website count
        freshWebsiteCount++;
        
        // Add to the website queue
        websiteQueue.push(businessInfo);
        console.log(`Added new business to queue: ${businessInfo.businessName}, Website: ${businessInfo.website}`);
      } else {
        console.log(`Skipping duplicate business: ${businessInfo.businessName}, Website: ${businessInfo.website}`);
      }
    }
    
    // Update progress
    updatePopupProgress(`Processed ${freshWebsiteCount} businesses...`, 30 + (freshWebsiteCount / maxResults) * 50);
    
    // Check if we've reached the maxResults limit
    if (freshWebsiteCount >= maxResults) {
      console.log(`Reached target of ${maxResults} fresh websites. Stopping collection.`);
      break;
    }
  }
  
  // Finalize the search process
  finishSearch();
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
  // Store the last status message in session storage
  try {
    sessionStorage.setItem('gmjs_contentStatus', status);
    sessionStorage.setItem('gmjs_contentProgress', progress.toString());
  } catch (e) {
    console.error('Error saving status to session storage:', e);
  }
  
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
  
  const completedTimestamp = Date.now();
  
  // Set a flag in session storage to indicate search completion
  try {
    // Set completion flags and status
    sessionStorage.setItem('gmjs_searchCompleted', 'true');
    sessionStorage.setItem('gmjs_contentStatus', 'Search completed!');
    sessionStorage.setItem('gmjs_contentProgress', '100');
    
    // Clear the in-progress flag to avoid confusion
    sessionStorage.removeItem('gmjs_search_in_progress');
    
    // Clear any remaining search state data
    sessionStorage.removeItem('gmjs_websiteQueue');
    sessionStorage.removeItem('gmjs_currentIndex');
    
    // Set a timestamp to track when the search was completed
    sessionStorage.setItem('gmjs_searchCompletedTimestamp', completedTimestamp.toString());
    
    // Store the final results in session storage as well
    // This ensures they're available if the popup reopens immediately
    try {
      // We need to stringify the results first
      sessionStorage.setItem('gmjs_finalResults', JSON.stringify(searchResults));
      console.log(`Stored ${searchResults.length} final results in session storage`);
    } catch (storageErr) {
      console.error('Error storing final results in session storage:', storageErr);
    }
    
    console.log('Search completed, set searchCompleted flag in session storage');
  } catch (e) {
    console.error('Error setting search completion in session storage:', e);
  }
  
  // Send a message to the background script to store the updated results
  // This ensures the results are available when the popup reopens
  chrome.runtime.sendMessage({
    action: 'searchComplete',
    finalResults: searchResults,
    completedTimestamp: completedTimestamp
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
  
  // Reset the search flag immediately to stop any ongoing processes
  searchInProgress = false;
  
  // Clear all search-related timers to stop any scheduled operations
  // This will stop any pending setTimeout operations for scrolling, clicking, etc.
  const highestTimeoutId = setTimeout(() => {}, 0);
  for (let i = 0; i < highestTimeoutId; i++) {
    clearTimeout(i);
  }
  
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
    // Clear all search-related flags and data
    sessionStorage.removeItem('gmjs_search_in_progress');
    sessionStorage.removeItem('gmjs_websiteQueue');
    sessionStorage.removeItem('gmjs_searchData');
    sessionStorage.removeItem('gmjs_currentIndex');
    sessionStorage.removeItem('gmjs_searchCompleted');
    sessionStorage.removeItem('gmjs_contentStatus');
    sessionStorage.removeItem('gmjs_contentProgress');
    
    console.log('Successfully cleared all search state from session storage');
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
    
    // Force close any open business details panels
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
        closeButton.click();
      }
    }
    
    // Force click any back buttons to get to the main view
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
      'button.DVeyrd'
    ];
    
    for (const selector of backButtonSelectors) {
      const backButton = document.querySelector(selector);
      if (backButton) {
        backButton.click();
      }
    }
  } catch (e) {
    console.error('Error resetting Google Maps view:', e);
  }
  
  // Update progress to inform user that search was cancelled
  updatePopupProgress('Search cancelled', 0);
}

// Process the queue of websites to search for job listings
function processWebsiteQueue() {
  const totalWebsites = websiteQueue.length;
  
  // First check if search was already completed to prevent duplicate processing on page refresh
  const searchCompleted = sessionStorage.getItem('gmjs_searchCompleted') === 'true';
  if (searchCompleted) {
    console.log('Search already completed, not processing websites again');
    
    // Make sure searchInProgress is false
    searchInProgress = false;
    
    // Make sure we keep the completed state but don't reprocess websites
    return;
  }
  
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
      
      const rememberDays = settings.cacheTime || 7; // Default to 7 days if not set
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