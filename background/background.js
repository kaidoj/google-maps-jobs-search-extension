// Background script for Hidden Job Search Helper extension

// Import helper scripts
importScripts('helpers.js');
importScripts('career-page-helpers.js');

let activeTabId = null;
let websiteProcessingQueue = [];
let processingInProgress = false;
let searchResults = [];
let maxResultsLimit = 20; // Default max results limit
let searchStatus = ''; // Track current search status
let lastStatusMessage = ''; // Track detailed status message
let popupOpenStatus = false; // Track whether a popup is currently open

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Keep track of the active tab with our content script
  if (sender.tab) {
    activeTabId = sender.tab.id;
  }
  
  if (message.action === 'processWebsites' && message.data) {
    // Set max results limit from search data
    maxResultsLimit = message.data.searchData.maxResults || 20;
    
    console.log(`Processing websites with max results limit: ${maxResultsLimit}`);
    
    // Get websites from the content script (these should all be fresh websites, 
    // as cached ones are already filtered out in content.js)
    const websites = message.data.websites;
    
    console.log(`Received ${websites.length} fresh websites to process`);
    
    // Initialize the processing queue (all sites are fresh, not from cache)
    websiteProcessingQueue = websites.map(site => {
      return {
        ...site,
        processed: false,
        jobKeywords: [],
        contactEmail: null,
        contactPage: null
      };
    });
    
    // Store search data
    const searchData = message.data.searchData;
    
    // Start processing websites if not already in progress
    if (!processingInProgress && websiteProcessingQueue.length > 0) {
      processingInProgress = true;
      searchStatus = 'processing';
      // Store the fact that we've started processing in storage
      storeSearchState();
      processNextWebsite(searchData);
    } else if (websiteProcessingQueue.length === 0) {
      // No websites to process, notify completion
      searchStatus = 'complete';
      storeSearchState();
      forwardMessageToPopup({
        action: 'searchComplete'
      });
    }
    
    sendResponse({ 
      status: 'processing',
      queuedCount: websiteProcessingQueue.length
    });
    return true;
  } else if (message.action === 'cancelSearch') {
    // Handle cancel search request
    cancelSearchProcess();
    sendResponse({ status: 'search_cancelled' });
    return true;
  } else if (message.action === 'updateProgress') {
    // Store the detailed status message for state persistence
    if (message.status) {
      lastStatusMessage = message.status;
    }
    
    // Forward progress update to popup
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'searchComplete') {
    // Forward completion message to popup
    searchStatus = 'complete';
    storeSearchState();
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'addResult') {
    // Add result and forward to popup
    searchResults.push(message.result);
    // Store results whenever a new one is added
    storeSearchState();
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'updateResult') {
    // Update an existing result and forward to popup
    forwardMessageToPopup(message);
    // Store updated results
    storeSearchState();
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'getSearchResults') {
    // Get search results from storage if they exist
    chrome.storage.local.get(['searchResults', 'searchStatus', 'detailedStatusMessage', 'websiteProcessingQueue', 'processingInProgress', 'maxResultsLimit'], function(data) {
      if (data.searchResults) {
        sendResponse({ 
          results: data.searchResults,
          status: data.searchStatus || 'unknown',
          detailedStatusMessage: data.detailedStatusMessage || '',
          websiteProcessingQueue: data.websiteProcessingQueue || [],
          processingInProgress: data.processingInProgress || false,
          maxResultsLimit: data.maxResultsLimit || 20
        });
      } else {
        // Fall back to in-memory results
        sendResponse({ 
          results: searchResults,
          status: searchStatus,
          detailedStatusMessage: lastStatusMessage || '',
          websiteProcessingQueue: websiteProcessingQueue,
          processingInProgress: processingInProgress,
          maxResultsLimit: maxResultsLimit
        });
      }
    });
    return true;
  } else if (message.action === 'popupOpened') {
    // Mark popup as open
    popupOpenStatus = true;
    sendResponse({ acknowledged: true });
    return true;
  } else if (message.action === 'ping') {
    // This is used to check if the popup is still open
    sendResponse({ alive: true });
    return true;
  }
});

// Store search state in chrome.storage.local
function storeSearchState() {
  // Get the current status message from the latest update
  let detailedStatus = searchStatus;
  if (lastStatusMessage && processingInProgress) {
    detailedStatus = lastStatusMessage;
  }

  chrome.storage.local.set({
    searchResults: searchResults,
    searchStatus: searchStatus,
    detailedStatusMessage: detailedStatus,
    websiteProcessingQueue: websiteProcessingQueue,
    processingInProgress: processingInProgress,
    maxResultsLimit: maxResultsLimit,
    lastUpdated: new Date().getTime(),
    // Also store as popupResults for popup-specific state management
    popupResults: searchResults,
    popupStatus: detailedStatus,
    popupProgress: processingInProgress ? '50%' : '100%'
  });
}

// Function to check if a URL is in the cache
function checkUrlInCache(url) {
  return new Promise((resolve) => {
    // First check if cache is enabled
    chrome.storage.local.get(['enableCache', 'cacheTime'], function(settings) {
      const cacheEnabled = settings.enableCache !== false; // Default to true if not set
      
      // If cache is disabled, resolve with null
      if (!cacheEnabled) {
        resolve(null);
        return;
      }
      
      const cacheTime = settings.cacheTime || 30; // Default to 30 days if not set
      const cacheKey = 'cached_' + btoa(url); // Base64 encode the URL as the key
      
      // Check for cached data
      chrome.storage.local.get([cacheKey], function(data) {
        if (data[cacheKey]) {
          const cachedData = data[cacheKey];
          const now = new Date().getTime();
          const expirationTime = cachedData.timestamp + (cacheTime * 24 * 60 * 60 * 1000); // Convert days to milliseconds
          
          // Check if cache is still valid
          if (now < expirationTime) {
            // Cache is valid, return the data
            resolve(cachedData.data);
          } else {
            // Cache is expired, remove it
            chrome.storage.local.remove([cacheKey], function() {
              console.log('Removed expired cache entry:', url);
              resolve(null);
            });
          }
        } else {
          // No cache entry found
          resolve(null);
        }
      });
    });
  });
}

// Function to cache a website result
function cacheWebsiteResult(url, result) {
  // First check if cache is enabled
  chrome.storage.local.get(['enableCache'], function(settings) {
    const cacheEnabled = settings.enableCache !== false; // Default to true if not set
    
    // If cache is disabled, don't cache
    if (!cacheEnabled) {
      return;
    }
    
    const cacheKey = 'cached_' + btoa(url); // Base64 encode the URL as the key
    
    // Create cache entry
    const cacheEntry = {
      timestamp: new Date().getTime(),
      data: result
    };
    
    // Store in cache
    chrome.storage.local.set({ [cacheKey]: cacheEntry }, function() {
      console.log('Cached result for:', url);
    });
  });
}

// Process the next website in the queue
function processNextWebsite(searchData) {
  // Check if there are any unprocessed websites
  const nextWebsiteIndex = websiteProcessingQueue.findIndex(site => !site.processed);
  
  if (nextWebsiteIndex === -1) {
    // All websites processed
    processingInProgress = false;
    
    // Notify content script that all websites have been processed
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { 
        action: 'websitesProcessed',
        results: searchResults
      });
    }
    
    // Send completion message to popup
    forwardMessageToPopup({
      action: 'searchComplete'
    });
    
    return;
  }
  
  const website = websiteProcessingQueue[nextWebsiteIndex];
  
  // Debug log to check businessName
  console.log('Processing website with name:', website.businessName);
  
  // Update progress - show current website being processed
  const processedCount = websiteProcessingQueue.filter(site => site.processed).length;
  const totalCount = Math.min(websiteProcessingQueue.length, maxResultsLimit);
  const progress = 50 + ((processedCount / totalCount) * 50);
  
  forwardMessageToPopup({
    action: 'updateProgress',
    status: `Processing website ${processedCount + 1} of ${totalCount}: ${website.businessName || 'Unknown Business'}`,
    progress
  });
  
  // Content.js has already filtered out cached websites,
  // so we can process this website directly
  processWebsiteWithTab(website, nextWebsiteIndex, searchData);
}

// Process website by creating a new tab
function processWebsiteWithTab(website, nextWebsiteIndex, searchData) {
  // Create a new tab to visit the website
  chrome.tabs.create({ 
    url: website.website,
    active: false // Open in background tab
  }, tab => {
    // Wait for the tab to load
    const tabId = tab.id;
    let loadTimeout = null;
    let loadCompleted = false;
    
    // Set up a listener for when the tab completes loading
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        loadCompleted = true;
        // Remove this listener
        chrome.tabs.onUpdated.removeListener(listener);
        
        // Clear timeout if it's still active
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
        
        // Execute script in the tab to search for job-related content
        chrome.scripting.executeScript({
          target: { tabId },
          function: searchForJobContent,
          args: [website, searchData]
        }).then(results => {
          // Process the results
          if (results && results[0] && results[0].result) {
            const result = results[0].result;
            
            // Add lastChecked timestamp for cache age
            result.lastChecked = new Date().toISOString();
            
            // Mark website as processed
            websiteProcessingQueue[nextWebsiteIndex] = {
              ...website,
              ...result,
              processed: true
            };
            
            // Cache the result for future use
            cacheWebsiteResult(website.website, result);
            
            // Process job site links if found
            const jobSiteLinks = result.jobSiteLinks || [];
            console.log('Job site links found:', jobSiteLinks);
            
            // Create a complete result object to use for updates later
            const completeResult = {
              ...website,
              ...result,
              processed: true
            };
            
            // If job keywords or contact info was found, add to results
            if ((result.jobKeywords && result.jobKeywords.length > 0) || 
                result.contactEmail || result.contactPage ||
                (result.jobListings && result.jobListings.length > 0) ||
                (result.jobSiteLinks && result.jobSiteLinks.length > 0)) {
              const completeResult = {
                businessName: website.businessName || "Unknown Business",
                address: website.address || "",
                website: website.website,
                jobKeywords: result.jobKeywords || [],
                contactEmail: result.contactEmail,
                contactPage: result.contactPage,
                careerPage: result.careerPage, // Add separate career page field
                jobPages: result.jobPages || [],
                jobListings: result.jobListings || [],
                jobSiteLinks: result.jobSiteLinks || [], // Include job site links
                score: result.score || 0,
                lastChecked: result.lastChecked
              };
              
              searchResults.push(completeResult);
              
              // Send result to popup
              forwardMessageToPopup({
                action: 'addResult',
                result: completeResult
              });
              
              // Process job site links if found
              if (jobSiteLinks && jobSiteLinks.length > 0) {
                console.log(`Processing ${Math.min(jobSiteLinks.length, 2)} job site links for ${website.businessName}`);
                console.log('Job site links details:', JSON.stringify(jobSiteLinks.slice(0, 2)));
                
                // Process job links in a timeout to allow the main site processing to complete first
                setTimeout(() => {
                  processJobSiteLinks(jobSiteLinks.slice(0, 2), website, completeResult, searchData, nextWebsiteIndex);
                }, 500);
              }
              
              // Process career page(s) if found
              if (completeResult.careerPage) {
                console.log(`Processing career page for ${website.businessName}: ${completeResult.careerPage}`);
                setTimeout(() => {
                  processCareerPage(completeResult.careerPage, website, completeResult, searchData, nextWebsiteIndex);
                }, 1000);
              } else if (completeResult.jobPages && completeResult.jobPages.length > 0) {
                // Process the first job page if no specific career page was identified
                const jobPage = completeResult.jobPages[0];
                console.log(`Processing job page for ${website.businessName}: ${jobPage.url}`);
                setTimeout(() => {
                  processCareerPage(jobPage.url, website, completeResult, searchData, nextWebsiteIndex);
                }, 1000);
              }
            }
          } else {
            // Mark as processed even if there's an error
            websiteProcessingQueue[nextWebsiteIndex].processed = true;
          }
          
          // Close the tab
          chrome.tabs.remove(tabId);
          
          // Process the next website
          setTimeout(() => {
            processNextWebsite(searchData);
          }, 500);
        }).catch(error => {
          console.error('Error executing script:', error);
          
          // Mark as processed even if there's an error
          websiteProcessingQueue[nextWebsiteIndex].processed = true;
          
          // Close the tab
          chrome.tabs.remove(tabId);
          
          // Process the next website
          setTimeout(() => {
            processNextWebsite(searchData);
          }, 500);
        });
      }
    });
    
    // Set a timeout of 15 seconds for loading the website
    loadTimeout = setTimeout(() => {
      if (!loadCompleted) {
        console.log(`Timeout: Website ${website.website} took too long to load (> 15s)`);
        
        const result = {
          processed: true,
          timedOut: true,
          lastChecked: new Date().toISOString()
        };
        
        // Mark website as processed with a timeout flag
        websiteProcessingQueue[nextWebsiteIndex] = {
          ...website,
          ...result
        };
        
        // Cache the timeout result
        cacheWebsiteResult(website.website, result);
        
        // Send the timeout result to popup with complete business info
        forwardMessageToPopup({
          action: 'addResult',
          result: {
            businessName: website.businessName,
            address: website.address,
            website: website.website,
            timedOut: true,
            lastChecked: result.lastChecked
          }
        });
        
        // Try to close the tab
        try {
          chrome.tabs.remove(tabId);
        } catch (e) {
          console.error('Error closing tab:', e);
        }
        
        // Process the next website
        setTimeout(() => {
          processNextWebsite(searchData);
        }, 500);
      }
    }, 15000); // 15 seconds timeout
  });
}

// Function to be injected into each website to search for job-related content
function searchForJobContent(website, searchData) {
  // We'll no longer use the iframe approach to avoid refreshing issues
  // Instead, we'll just record the job site links and let the background script handle visiting them

  // Result object
  const result = {
    jobKeywords: [],
    contactEmail: null,
    contactPage: null,
    jobPages: [],
    jobListings: [],
    jobSiteLinks: [], // New field for job site links like BambooHR
    score: 0, // Initialize score
    businessName: website.businessName || "Unknown Business" // Explicitly carry over the business name
  };
  
  try {
    // Log the business name for debugging
    console.log("Processing business website for:", result.businessName);
    
    // Get all text content of the page
    const pageText = document.body.textContent.toLowerCase();
    
    // Get all links
    const links = Array.from(document.querySelectorAll('a'));
    
    // Search for job-related keywords
    const searchKeywords = searchData.keywords;
    
    // Define default common job-related terms to look for
    const defaultJobTerms = [
      'job', 'jobs', 'career', 'careers', 'work', 'vacancy', 'vacancies',
      'hire', 'hiring', 'apply', 'application', 'position', 'spontaneous',
      'opportunity', 'employment', 'recruitment', 'join us', 'join our team',
    ];
    
    // Use custom website keywords if provided, otherwise use defaults
    const commonJobTerms = searchData.websiteKeywords || defaultJobTerms;
    
    // Common paths to check for careers/jobs
    const jobPaths = [
      '/jobs', '/careers', '/career', '/join-us', '/join', '/work-with-us',
      '/vacancy', '/vacancies', '/positions', '/opportunities', '/about/careers',
      '/about/jobs', '/company/careers', '/company/jobs', '/jobs-and-careers'
    ];
    
    // Search for common job terms in the page
    for (const term of commonJobTerms) {
      if (pageText.includes(term)) {
        if (!result.jobKeywords.includes(term)) {
          result.jobKeywords.push(term);
          result.score += 5; // Add 5 points for each common job term found
        }
      }
    }
    
    // Search for user-provided keywords
    for (const keyword of searchKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (pageText.includes(keywordLower)) {
        if (!result.jobKeywords.includes(keyword)) {
          result.jobKeywords.push(keyword);
          result.score += 20; // Add 20 points for each user keyword found on main page
        }
      }
    }
    
    // Search for job links
    const jobLinks = links.filter(link => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent.toLowerCase();
      
      // Check if the link text contains job-related keywords
      const hasJobText = commonJobTerms.some(term => text.includes(term));
      
      // Check if the URL path contains job-related paths
      const hasJobPath = jobPaths.some(path => href.toLowerCase().includes(path));
      
      return hasJobText || hasJobPath;
    });
    
    // If job links are found, process them
    if (jobLinks.length > 0) {
      // Found job links - add to score
      result.score += 30; // Add 30 points for having job pages
      
      // Process up to 3 job links to avoid excessive processing
      const linksToProcess = jobLinks.slice(0, 3);
      
      for (const jobLink of linksToProcess) {
        let href = jobLink.getAttribute('href');
        const linkText = jobLink.textContent.trim();
        
        // Make sure the URL is absolute
        if (href && !href.startsWith('http')) {
          // Handle relative URLs
          if (href.startsWith('/')) {
            const url = new URL(window.location.href);
            href = `${url.protocol}//${url.host}${href}`;
          } else {
            // Handle relative to current path
            const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            href = baseUrl + href;
          }
        }
        
        if (href) {
          // Add to job pages
          result.jobPages.push({
            url: href,
            title: linkText || 'Job/Career Page'
          });
          
          // Store career/job pages separately from contact pages
          // DO NOT set job/career pages as contact pages
          result.careerPage = href;
          
          // Store the career page to visit after initial scanning is complete
          // We don't directly visit it here to avoid multiple tabs being opened simultaneously
          // The actual career page processing will happen after this website's scan completes
          try {
            console.log(`Found career/job page: ${href} - will process after initial scan`);
            // We've stored the href in result.careerPage and result.jobPages already
            // So we don't need to do anything else here 
          } catch (error) {
            console.error('Error setting up job page visit:', error);
          }
        }
      }
    }
    
    // Search for contact information
    
    // Find email addresses
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = pageText.match(emailRegex);
    
    if (emailMatches && emailMatches.length > 0) {
      // Use the first email found
      result.contactEmail = emailMatches[0];
      result.score += 10; // Add 10 points for having contact email
    }
    
    // Search for known job site links like BambooHR, Lever, Greenhouse, etc.
    const knownJobSites = [
      { domain: 'bamboohr.com', name: 'BambooHR' },
      { domain: 'lever.co', name: 'Lever' },
      { domain: 'greenhouse.io', name: 'Greenhouse' },
      { domain: 'workday.com', name: 'Workday' },
      { domain: 'myworkdayjobs.com', name: 'Workday Jobs' },
      { domain: 'taleo.net', name: 'Taleo' },
      { domain: 'smartrecruiters.com', name: 'SmartRecruiters' },
      { domain: 'jobvite.com', name: 'Jobvite' },
      { domain: 'applytojob.com', name: 'ApplyToJob' },
      { domain: 'recruitee.com', name: 'Recruitee' },
      { domain: 'applicantstack.com', name: 'ApplicantStack' }
    ];

    // Look for links to known job sites
    const jobSiteLinks = links.filter(link => {
      const href = link.getAttribute('href') || '';
      return knownJobSites.some(site => href.includes(site.domain));
    });

    // Process job site links if found
    if (jobSiteLinks.length > 0) {
      // Add a bonus to the score for having links to job sites
      result.score += 25; // Significant bonus for having specific job site links
      console.log(`Found ${jobSiteLinks.length} job site links on main page`);
      
      // Process up to 2 job site links
      for (const jobSiteLink of jobSiteLinks.slice(0, 2)) {
        let href = jobSiteLink.getAttribute('href');
        
        // Make sure the URL is absolute
        if (href && !href.startsWith('http')) {
          if (href.startsWith('/')) {
            const url = new URL(window.location.href);
            href = `${url.protocol}//${url.host}${href}`;
          } else {
            const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            href = baseUrl + href;
          }
        }
        
        // Determine which job site this is
        const jobSite = knownJobSites.find(site => href.includes(site.domain));
        const jobSiteName = jobSite ? jobSite.name : 'Job Site';
        
        // Add to job site links
        result.jobSiteLinks.push({
          url: href,
          name: jobSiteName,
          foundOn: 'Main Page'
        });
        
        console.log(`Found job site link on main page: ${jobSiteName} at ${href}`);
        // We'll use the tab-based approach to visit this link when main processing is complete
      }
    }
    
    // If no email found, look for a contact page
    if (!result.contactEmail && !result.contactPage) {
      const contactLinks = links.filter(link => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent.toLowerCase();
        
        // Check for contact-related text
        const hasContactText = text.includes('contact');
        
        // Check for contact-related URL paths
        const hasContactPath = href.toLowerCase().includes('/contact');
        
        return hasContactText || hasContactPath;
      });
      
      if (contactLinks.length > 0) {
        const contactLink = contactLinks[0];
        let href = contactLink.getAttribute('href');
        
        // Make sure the URL is absolute
        if (href && !href.startsWith('http')) {
          // Handle relative URLs
          if (href.startsWith('/')) {
            const url = new URL(window.location.href);
            href = `${url.protocol}//${url.host}${href}`;
          } else {
            // Handle relative to current path
            const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            href = baseUrl + href;
          }
        }
        
        if (href) {
          result.contactPage = href;
          result.score += 5; // Add 5 points for contact page
        }
      }
    }
    
    // Ensure score is at least 1 if any job-related information was found
    if (result.jobKeywords.length > 0 || result.jobListings.length > 0 || 
        result.jobPages.length > 0) {
      result.score = Math.max(result.score, 1);
    }
    
    return result;
  } catch (error) {
    console.error('Error searching website:', error);
    return result;
  }
}

// Forward a message from content script to popup
function forwardMessageToPopup(message) {
  chrome.runtime.sendMessage(message).catch(error => {
    // Ignore errors - popup might not be open
  });
}

// Cancel any ongoing search process and clean up resources
function cancelSearchProcess() {
  console.log('Cancelling background search process');
  
  // Set flag immediately to prevent any new website processing
  processingInProgress = false;
  searchStatus = 'cancelled';
  
  // Clear any pending timers to prevent scheduled processing
  const highestTimeoutId = setTimeout(() => {}, 0);
  for (let i = 0; i < highestTimeoutId; i++) {
    clearTimeout(i);
  }
  
  // First, find any tabs that were opened by our extension for website processing
  if (websiteProcessingQueue && websiteProcessingQueue.length > 0) {
    // Only query for tabs that match websites in our queue
    const websiteUrls = websiteProcessingQueue
      .filter(site => !site.processed)
      .map(site => site.website);
    
    if (websiteUrls.length > 0) {
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          // Check if this tab is one we opened for processing
          const isProcessingTab = websiteUrls.some(url => {
            try {
              // Check if tab URL starts with the website URL
              return tab.url && tab.url.startsWith(url);
            } catch (e) {
              return false;
            }
          });
          
          // Close any processing tabs
          if (isProcessingTab) {
            chrome.tabs.remove(tab.id).catch(e => {
              console.error('Error closing tab:', e);
            });
          }
        });
      });
    }
  }
  
  // Mark all websites as processed to stop further processing
  if (websiteProcessingQueue && websiteProcessingQueue.length > 0) {
    websiteProcessingQueue = websiteProcessingQueue.map(site => ({
      ...site,
      processed: true
    }));
  }
  
  // Notify content script that the search was cancelled
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, {
      action: 'searchCancelled'
    }).catch(() => {
      // Ignore errors if content script is not available
    });
  }
  
  // Send cancellation message to popup
  forwardMessageToPopup({
    action: 'searchCancelled',
    status: 'Search cancelled'
  });
  
  // Reset all search-related state
  searchResults = [];
  websiteProcessingQueue = [];
  
  // Clear the stored state in chrome.storage.local
  chrome.storage.local.remove([
    'searchResults',
    'searchStatus',
    'websiteProcessingQueue',
    'processingInProgress',
    'lastUpdated'
  ], () => {
    console.log('Cleared search state from chrome.storage.local');
  });
  
  // Also clear session storage if we have tab access
  if (activeTabId) {
    chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      function: () => {
        try {
          // Clear any session storage related to search state
          sessionStorage.removeItem('gmjs_search_in_progress');
          sessionStorage.removeItem('gmjs_websiteQueue');
          sessionStorage.removeItem('gmjs_searchData');
          sessionStorage.removeItem('gmjs_currentIndex');
          console.log('Cleared session storage in content script');
        } catch (e) {
          console.error('Error clearing session storage:', e);
        }
      }
    }).catch(e => {
      console.error('Error executing clear session storage script:', e);
    });
  }
  
  console.log('Background search process cancelled and all state cleared');
}

// Listen for port connections (from popup)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    console.log('Popup connected to background');
    popupOpenStatus = true;
    
    // Listen for disconnection
    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected from background');
      popupOpenStatus = false;
      
      // Store state when popup closes to ensure it's saved
      storeSearchState();
    });
  }
});

// Process job site links by creating new tabs
function processJobSiteLinks(jobSiteLinks, parentWebsite, parentResult, searchData, parentWebsiteIndex) {
  if (!jobSiteLinks || jobSiteLinks.length === 0) {
    return;
  }
  
  // Get the first link to process
  const jobSiteLink = jobSiteLinks[0];
  const remainingLinks = jobSiteLinks.slice(1);
  
  console.log(`Opening job site link in new tab: ${jobSiteLink.name} - ${jobSiteLink.url}`);
  
  // Create a new tab to visit the job site
  chrome.tabs.create({ 
    url: jobSiteLink.url,
    active: false // Open in background tab
  }, tab => {
    // Wait for the tab to load
    const tabId = tab.id;
    let loadTimeout = null;
    let loadCompleted = false;
    
    // Set up a listener for when the tab completes loading
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        loadCompleted = true;
        // Remove this listener
        chrome.tabs.onUpdated.removeListener(listener);
        
        // Clear timeout if it's still active
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
        
        console.log(`Tab ${tabId} for ${jobSiteLink.name} has completed loading`);
        
        // Give the page a moment to fully initialize (especially for JS-heavy sites)
        setTimeout(() => {
          // Execute script in the tab to search for job-related content on the job site
          chrome.scripting.executeScript({
            target: { tabId },
            function: searchJobSiteForKeywords,
            args: [parentWebsite, searchData, jobSiteLink]
          }).then(results => {
            console.log(`Script executed in job site tab, processing results...`);
            // Process the results
            if (results && results[0] && results[0].result) {
              const jobSiteResult = results[0].result;
              console.log(`Job site result for ${jobSiteLink.name}:`, jobSiteResult);
              
              // If keywords were found on the job site
              if (jobSiteResult.foundKeywords && jobSiteResult.foundKeywords.length > 0) {
                console.log(`Found ${jobSiteResult.foundKeywords.length} keywords on job site: ${jobSiteResult.foundKeywords.join(', ')}`);
                
                // Update the parent result with job site findings
                parentResult.score = Math.max(parentResult.score, 100); // Set score to maximum
                
                // Add keywords found on job site to parent result
                for (const keyword of jobSiteResult.foundKeywords) {
                  if (!parentResult.jobKeywords.includes(keyword)) {
                    parentResult.jobKeywords.push(keyword);
                  }
                }
                
                // Add job listings found on the job site
                if (jobSiteResult.jobListings && jobSiteResult.jobListings.length > 0) {
                  console.log(`Found ${jobSiteResult.jobListings.length} job listings on job site`);
                  
                  // Initialize jobListings array if it doesn't exist
                  if (!parentResult.jobListings) {
                    parentResult.jobListings = [];
                  }
                  
                  for (const jobListing of jobSiteResult.jobListings) {
                    jobListing.source = jobSiteLink.url;
                    jobListing.jobSite = jobSiteLink.name;
                    parentResult.jobListings.push(jobListing);
                  }
                }
                
                // Update the website in the processing queue with enhanced score and data
                if (websiteProcessingQueue[parentWebsiteIndex]) {
                  console.log(`Updating processing queue item ${parentWebsiteIndex} with job site results`);
                  
                  websiteProcessingQueue[parentWebsiteIndex] = {
                    ...websiteProcessingQueue[parentWebsiteIndex],
                    score: parentResult.score,
                    jobKeywords: parentResult.jobKeywords,
                    jobListings: parentResult.jobListings,
                    jobSiteLinks: parentResult.jobSiteLinks
                  };
                  
                  // Update the cache with the enhanced result
                  cacheWebsiteResult(parentWebsite.website, {
                    ...parentResult,
                    score: parentResult.score,
                    jobKeywords: parentResult.jobKeywords,
                    jobListings: parentResult.jobListings,
                    jobSiteLinks: parentResult.jobSiteLinks
                  });
                }
                
                // Update the result in searchResults if it's already been added
                let resultUpdated = false;
                for (let i = 0; i < searchResults.length; i++) {
                  if (searchResults[i].website === parentWebsite.website) {
                    console.log(`Updating search result for ${parentWebsite.website} with job site data`);
                    
                    searchResults[i] = {
                      ...searchResults[i],
                      score: parentResult.score,
                      jobKeywords: parentResult.jobKeywords,
                      jobListings: parentResult.jobListings,
                      jobSiteLinks: parentResult.jobSiteLinks
                    };
                    
                    // Send the updated result to popup
                    forwardMessageToPopup({
                      action: 'updateResult',
                      result: searchResults[i]
                    });
                    resultUpdated = true;
                    break;
                  }
                }
                
                if (!resultUpdated) {
                  console.log(`Result for ${parentWebsite.website} not found in searchResults, can't update UI`);
                }
              } else {
                console.log(`No keywords found on job site ${jobSiteLink.name}`);
              }
            } else {
              console.log(`No valid results returned from job site script execution`);
            }
          
          // Close the tab
          chrome.tabs.remove(tabId);
          
          // Process the next job site link if any
          if (remainingLinks.length > 0) {
            setTimeout(() => {
              processJobSiteLinks(remainingLinks, parentWebsite, parentResult, searchData, parentWebsiteIndex);
            }, 500);
          } else {
            // We've processed all job site links, store the final result state
            console.log(`Finished processing all job site links for ${parentWebsite.website}`);
            storeSearchState();
          }
        }).catch(error => {
          console.error('Error executing script on job site:', error);
          
          // Close the tab
          chrome.tabs.remove(tabId);
          
          // Process the next job site link if any
          if (remainingLinks.length > 0) {
            setTimeout(() => {
              processJobSiteLinks(remainingLinks, parentWebsite, parentResult, searchData, parentWebsiteIndex);
            }, 500);
          }
        });
        }, 1000); // Give the page 1 second to fully initialize
      }
    });
    
    // Set a timeout of 20 seconds for loading the website
    loadTimeout = setTimeout(() => {
      if (!loadCompleted) {
        console.log(`Timeout: Job site ${jobSiteLink.url} took too long to load (> 20s)`);
        
        // Try to close the tab
        try {
          chrome.tabs.remove(tabId);
        } catch (e) {
          console.error('Error closing tab:', e);
        }
        
        // Process the next job site link if any
        if (remainingLinks.length > 0) {
          setTimeout(() => {
            processJobSiteLinks(remainingLinks, parentWebsite, parentResult, searchData, parentWebsiteIndex);
          }, 500);
        }
      }
    }, 20000); // 20 seconds timeout (increased to give more time for heavy job sites)
  });
}

// Function to be injected into job site tabs to search for keywords
function searchJobSiteForKeywords(parentWebsite, searchData, jobSiteLink) {
  // Result object for the job site
  const result = {
    foundKeywords: [],
    jobListings: [],
    jobSiteName: jobSiteLink.name
  };
  
  try {
    console.log(`Searching job site ${jobSiteLink.name} for keywords: ${searchData.keywords.join(', ')}`);
    
    // Get the search keywords
    const searchKeywords = searchData.keywords;
    
    // Get all text content of the page
    const pageText = document.body.textContent.toLowerCase();
    console.log(`Job site page text length: ${pageText.length}`);
    
    // Always check for common job-related terms to verify this is actually a job site
    const jobTerms = ['job', 'career', 'position', 'apply', 'application', 'hiring', 'employment'];
    const isJobSite = jobTerms.some(term => pageText.includes(term.toLowerCase()));
    console.log(`Is confirmed job site: ${isJobSite}`);
    
    // Search for user-provided keywords on the job site
    for (const keyword of searchKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (pageText.includes(keywordLower)) {
        console.log(`Found keyword on job site: ${keyword}`);
        result.foundKeywords.push(keyword);
      }
    }
    
    console.log(`Found ${result.foundKeywords.length} keywords on job site`);
    
    // Always look for job listings, even if no keywords were found
    // Look for job listings on the job site (broader selector to catch more potential listings)
    const jobElements = Array.from(document.querySelectorAll(
      'div.job, div.position, li.job-listing, .job-title, .position-title, ' +
      '[class*="job"], [class*="position"], [class*="opening"], ' +
      '.careers-table tr, .job-card, .job-item, ' +
      '.listing-item, [data-test="job-card"], [data-component="JobCard"]'
    ));
    
    console.log(`Found ${jobElements.length} potential job elements`);
    
    // Process up to 3 job listings from the job site
    for (const jobElement of jobElements.slice(0, 3)) {
      const jobText = jobElement.textContent.trim();
      
      // Find the most likely job title
      let jobTitle = '';
      const headings = jobElement.querySelectorAll('h1, h2, h3, h4, h5, h6, strong');
      if (headings.length > 0) {
        jobTitle = headings[0].textContent.trim();
      }
      
      // Default title if nothing found
      if (!jobTitle) {
        jobTitle = 'Job Opening';
      }
      
      // Find matching keywords in this listing
      const matchedKeywords = searchKeywords.filter(keyword => 
        jobText.toLowerCase().includes(keyword.toLowerCase())
      );
      
      // Only add if it has matching keywords
      if (matchedKeywords.length > 0) {
        console.log(`Found job listing with keywords: ${matchedKeywords.join(', ')}`);
        result.jobListings.push({
          title: jobTitle,
          snippet: jobText.substring(0, 150) + '...',
          keywords: matchedKeywords
        });
      }
    }
    
    // If we found no listings but found keywords, add a generic listing
    if (result.foundKeywords.length > 0 && result.jobListings.length === 0) {
      console.log('Creating generic job listing for found keywords');
      result.jobListings.push({
        title: 'Job Opportunity',
        snippet: `This site contains keywords you're looking for: ${result.foundKeywords.join(', ')}`,
        keywords: result.foundKeywords
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error searching job site:', error);
    return result;
  }
}

// The searchForJobSiteLinks and processCareerPage functions are now imported from career-page-helpers.js