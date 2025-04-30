// Background script for Hidden Job Search Helper extension
let activeTabId = null;
let websiteProcessingQueue = [];
let processingInProgress = false;
let searchResults = [];
let maxResultsLimit = 20; // Default max results limit

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
      processNextWebsite(searchData);
    } else if (websiteProcessingQueue.length === 0) {
      // No websites to process, notify completion
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
    // Forward progress update to popup
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'searchComplete') {
    // Forward completion message to popup
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  } else if (message.action === 'addResult') {
    // Add result and forward to popup
    searchResults.push(message.result);
    forwardMessageToPopup(message);
    sendResponse({ received: true });
    return true;
  }
});

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
            
            // If job keywords or contact info was found, add to results
            if ((result.jobKeywords && result.jobKeywords.length > 0) || 
                result.contactEmail || result.contactPage ||
                (result.jobListings && result.jobListings.length > 0)) {
              const completeResult = {
                businessName: website.businessName || "Unknown Business",
                address: website.address || "",
                website: website.website,
                jobKeywords: result.jobKeywords || [],
                contactEmail: result.contactEmail,
                contactPage: result.contactPage,
                jobPages: result.jobPages || [],
                jobListings: result.jobListings || [],
                score: result.score || 0,
                lastChecked: result.lastChecked
              };
              
              searchResults.push(completeResult);
              
              // Send result to popup
              forwardMessageToPopup({
                action: 'addResult',
                result: completeResult
              });
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
  // Result object
  const result = {
    jobKeywords: [],
    contactEmail: null,
    contactPage: null,
    jobPages: [],
    jobListings: [],
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
          
          // If this is the first job link, set it as the contact page for backward compatibility
          if (!result.contactPage) {
            result.contactPage = href;
          }
          
          // Visit the job page to search for specific keywords
          try {
            // Create an iframe to load the job page
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            
            // Use a promise to handle the iframe loading
            const visitJobPage = new Promise((resolve, reject) => {
              // Set a timeout for iframe loading (5 seconds)
              const timeout = setTimeout(() => {
                reject(new Error('Job page iframe loading timeout'));
              }, 5000);
              
              iframe.onload = () => {
                clearTimeout(timeout);
                try {
                  // Get content from the iframe
                  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                  if (iframeDoc) {
                    const jobPageText = iframeDoc.body ? iframeDoc.body.textContent.toLowerCase() : '';
                    
                    // Extract job listings that contain the search keywords
                    const jobElements = Array.from(iframeDoc.querySelectorAll('div, section, article, li'));
                    
                    // Filter for elements that might contain job listings
                    const potentialJobListings = jobElements.filter(element => {
                      const elementText = element.textContent.toLowerCase();
                      // Check if element contains job-related terms
                      const hasJobTerms = commonJobTerms.some(term => elementText.includes(term.toLowerCase()));
                      // Check if element contains user keywords
                      const hasUserKeywords = searchKeywords.some(keyword => 
                        elementText.includes(keyword.toLowerCase())
                      );
                      
                      return hasJobTerms && hasUserKeywords && elementText.length > 100;
                    });
                    
                    let keywordsFoundOnJobPage = false;
                    
                    // Process potential job listings
                    for (const listingElement of potentialJobListings.slice(0, 5)) { // Limit to 5 listings
                      const listingText = listingElement.textContent.trim();
                      
                      // Find the most likely job title - look for h tags within or nearby
                      let jobTitle = '';
                      const headings = listingElement.querySelectorAll('h1, h2, h3, h4, h5, h6, strong');
                      if (headings.length > 0) {
                        jobTitle = headings[0].textContent.trim();
                      }
                      
                      // If no heading found, try to extract a title based on common patterns
                      if (!jobTitle) {
                        const titleMatches = listingText.match(/(?:job|position|role|vacancy|opening):\s*([^\n\.]+)/i);
                        if (titleMatches && titleMatches[1]) {
                          jobTitle = titleMatches[1].trim();
                        }
                      }
                      
                      // Default title if nothing found
                      if (!jobTitle) {
                        jobTitle = 'Job Opening';
                      }
                      
                      // Find matching keywords in this listing
                      const matchedKeywords = searchKeywords.filter(keyword => 
                        listingText.toLowerCase().includes(keyword.toLowerCase())
                      );
                      
                      // Only add if it has matching keywords
                      if (matchedKeywords.length > 0) {
                        result.jobListings.push({
                          title: jobTitle,
                          snippet: listingText.substring(0, 200) + '...',
                          keywords: matchedKeywords,
                          source: href
                        });
                        
                        // Perfect match - highest score (100)
                        result.score = Math.max(result.score, 100);
                        keywordsFoundOnJobPage = true;
                      }
                    }
                    
                    // Check if we found specific keywords in the job page, even if not in specific listings
                    let keywordMatchCount = 0;
                    for (const keyword of searchKeywords) {
                      if (jobPageText.includes(keyword.toLowerCase())) {
                        if (!result.jobKeywords.includes(keyword)) {
                          result.jobKeywords.push(keyword);
                          keywordMatchCount++;
                        }
                      }
                    }
                    
                    // If we found keywords on job page but not in specific listings
                    if (keywordMatchCount > 0 && !keywordsFoundOnJobPage) {
                      // Score 50-80 based on number of keywords found
                      const keywordBonus = Math.min(keywordMatchCount * 15, 30);
                      result.score = Math.max(result.score, 50 + keywordBonus);
                    }
                  }
                } catch (error) {
                  console.error('Error processing iframe content:', error);
                } finally {
                  resolve();
                }
              };
              
              iframe.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Failed to load job page in iframe'));
              };
              
              // Try to load the page in the iframe
              try {
                iframe.src = href;
              } catch (e) {
                clearTimeout(timeout);
                reject(e);
              }
            });
            
            // Wait for the page visit to complete with a timeout
            visitJobPage.catch(error => {
              console.error('Error visiting job page:', error);
            }).finally(() => {
              // Clean up the iframe
              try {
                if (iframe && iframe.parentNode) {
                  iframe.parentNode.removeChild(iframe);
                }
              } catch (e) {
                console.error('Error removing iframe:', e);
              }
            });
            
            // Since iframe loading is async and we need to return synchronously,
            // we won't wait for it to complete. The results will be partial.
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
  
  // Reset search results
  searchResults = [];
  
  console.log('Background search process cancelled');
}