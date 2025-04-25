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
    
    // Queue websites for processing, but limit to max results
    const websitesToProcess = message.data.websites.slice(0, maxResultsLimit);
    
    websiteProcessingQueue = websitesToProcess.map(site => ({
      ...site,
      processed: false,
      jobKeywords: [],
      contactEmail: null,
      contactPage: null
    }));
    
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
  console.log('Full website object:', JSON.stringify(website));
  
  // Update progress
  const progress = 50 + ((nextWebsiteIndex / websiteProcessingQueue.length) * 50);
  forwardMessageToPopup({
    action: 'updateProgress',
    status: `Processing website (${nextWebsiteIndex + 1}/${websiteProcessingQueue.length}): ${website.businessName || 'Unknown Business'}`,
    progress
  });
  
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
            
            // Mark website as processed
            websiteProcessingQueue[nextWebsiteIndex] = {
              ...website,
              ...result,
              processed: true
            };
            
            // If job keywords or contact info was found, add to results
            if ((result.jobKeywords && result.jobKeywords.length > 0) || 
                result.contactEmail || result.contactPage) {
              const completeResult = {
                businessName: website.businessName || "Unknown Business",
                address: website.address || "",
                website: website.website,
                jobKeywords: result.jobKeywords || [],
                contactEmail: result.contactEmail,
                contactPage: result.contactPage,
                lastChecked: new Date().toISOString()
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
        
        // Mark website as processed with a timeout flag
        websiteProcessingQueue[nextWebsiteIndex] = {
          ...website,
          processed: true,
          timedOut: true
        };
        
        // Send the timeout result to popup with complete business info
        forwardMessageToPopup({
          action: 'addResult',
          result: {
            businessName: website.businessName,
            address: website.address,
            website: website.website,
            timedOut: true,
            lastChecked: new Date().toISOString()
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
        }
      }
    }
    
    // Search for user-provided keywords
    for (const keyword of searchKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (pageText.includes(keywordLower)) {
        if (!result.jobKeywords.includes(keyword)) {
          result.jobKeywords.push(keyword);
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
    
    // If job links are found, get the first one as the careers/jobs page
    if (jobLinks.length > 0) {
      const jobLink = jobLinks[0];
      let href = jobLink.getAttribute('href');
      
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
      }
    }
    
    // Search for contact information
    
    // Find email addresses
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = pageText.match(emailRegex);
    
    if (emailMatches && emailMatches.length > 0) {
      // Use the first email found
      result.contactEmail = emailMatches[0];
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
        }
      }
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