/**
 * Career page helpers - Functions to better process career pages and job site links
 */

// Function to be injected into career pages to search for job site links
function searchForJobSiteLinks(careerPageUrl) {
  const result = {
    jobSiteLinks: [],
    keywords: []
  };
  
  try {
    console.log('Searching for job site links on career page:', careerPageUrl);
    
    // Define known job sites to look for
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
    
    // Get all links on the page
    const links = Array.from(document.querySelectorAll('a'));
    console.log(`Found ${links.length} links on career page`);
    
    // Filter for job site links
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      
      // Resolve relative URLs to absolute
      let absoluteUrl = href;
      if (!href.startsWith('http')) {
        try {
          absoluteUrl = new URL(href, window.location.href).href;
        } catch (e) {
          console.error('Error resolving URL:', e);
          continue;
        }
      }
      
      // Check if this URL matches any of our known job sites
      for (const jobSite of knownJobSites) {
        if (absoluteUrl.includes(jobSite.domain)) {
          console.log(`Found ${jobSite.name} link: ${absoluteUrl}`);
          result.jobSiteLinks.push({
            url: absoluteUrl,
            name: jobSite.name
          });
          break;
        }
      }
    }
    
    // Also look for common job-related keywords
    const pageText = document.body.textContent.toLowerCase();
    const commonKeywords = ['job', 'career', 'position', 'vacancy', 'opportunity', 'employment'];
    
    for (const keyword of commonKeywords) {
      if (pageText.includes(keyword)) {
        result.keywords.push(keyword);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error searching for job site links:', error);
    return result;
  }
}

// Process career pages in a separate tab to find job site links
function processCareerPage(careerPageUrl, parentWebsite, parentResult, searchData, parentWebsiteIndex) {
  console.log(`Opening career page in new tab: ${careerPageUrl}`);
  
  // Create a new tab to visit the career page
  chrome.tabs.create({ 
    url: careerPageUrl,
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
        
        console.log(`Career page tab ${tabId} has completed loading`);
        
        // Give the page a moment to fully initialize
        setTimeout(() => {
          // Execute script to find job site links
          chrome.scripting.executeScript({
            target: { tabId },
            function: searchForJobSiteLinks,
            args: [careerPageUrl]
          }).then(results => {
            if (results && results[0] && results[0].result) {
              const careerPageResults = results[0].result;
              console.log(`Found on career page:`, careerPageResults);
              
              // If job site links were found
              if (careerPageResults.jobSiteLinks && careerPageResults.jobSiteLinks.length > 0) {
                console.log(`Found ${careerPageResults.jobSiteLinks.length} job site links on career page`);
                
                // For each job site link found
                for (const jobSiteLink of careerPageResults.jobSiteLinks) {
                  // Make sure we don't have duplicate links
                  if (!parentResult.jobSiteLinks) {
                    parentResult.jobSiteLinks = [];
                  }
                  
                  const isDuplicate = parentResult.jobSiteLinks.some(link => 
                    link.url === jobSiteLink.url
                  );
                  
                  if (!isDuplicate) {
                    // Add the link to the parent result
                    parentResult.jobSiteLinks.push({
                      url: jobSiteLink.url,
                      name: jobSiteLink.name,
                      foundOn: 'Career Page'
                    });
                    
                    // Increase score for finding job site links
                    parentResult.score = Math.max(parentResult.score, 75);
                    
                    console.log(`Added job site link from career page: ${jobSiteLink.name} at ${jobSiteLink.url}`);
                  }
                }
                
                // Update the website processing queue
                if (websiteProcessingQueue[parentWebsiteIndex]) {
                  websiteProcessingQueue[parentWebsiteIndex] = {
                    ...websiteProcessingQueue[parentWebsiteIndex],
                    score: parentResult.score,
                    jobSiteLinks: parentResult.jobSiteLinks
                  };
                  
                  // Update the cache with the enhanced result
                  cacheWebsiteResult(parentWebsite.website, {
                    ...parentResult,
                    score: parentResult.score,
                    jobSiteLinks: parentResult.jobSiteLinks
                  });
                  
                  // Update in search results if already present
                  for (let i = 0; i < searchResults.length; i++) {
                    if (searchResults[i].website === parentWebsite.website) {
                      searchResults[i] = {
                        ...searchResults[i],
                        score: parentResult.score,
                        jobSiteLinks: parentResult.jobSiteLinks
                      };
                      
                      // Send the updated result to popup
                      forwardMessageToPopup({
                        action: 'updateResult',
                        result: searchResults[i]
                      });
                      break;
                    }
                  }
                  
                  // Store search state
                  storeSearchState();
                  
                  // Process the newly found job site links
                  setTimeout(() => {
                    processJobSiteLinks(
                      parentResult.jobSiteLinks.filter(link => link.foundOn === 'Career Page').slice(0, 2), 
                      parentWebsite, 
                      parentResult, 
                      searchData, 
                      parentWebsiteIndex
                    );
                  }, 500);
                }
              }
            }
            
            // Close the tab
            chrome.tabs.remove(tabId);
          }).catch(error => {
            console.error('Error executing script on career page:', error);
            chrome.tabs.remove(tabId);
          });
        }, 2000); // Give the page 2 seconds to fully initialize
      }
    });
    
    // Set a timeout of 15 seconds for loading the career page
    loadTimeout = setTimeout(() => {
      if (!loadCompleted) {
        console.log(`Timeout: Career page ${careerPageUrl} took too long to load (> 15s)`);
        
        // Try to close the tab
        try {
          chrome.tabs.remove(tabId);
        } catch (e) {
          console.error('Error closing tab:', e);
        }
      }
    }, 15000);
  });
}
