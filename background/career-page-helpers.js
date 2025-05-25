/**
 * Career page helpers - Functions to better process career pages and job site links
 */

// Function to be injected into career pages to search for job site links and user-defined keywords
function searchForJobSiteLinks(careerPageUrl, searchKeywords = [], jobKeywords = []) {
  const result = {
    jobSiteLinks: [],
    keywords: [],
    userKeywords: [], // Track user-defined keywords found
    jobSpecificKeywords: [], // Track job-specific keywords found
    score: 0,         // Keep track of score for this career page
    potential_job_match: false // Flag for potential job match
  };
  
  try {
    console.log('Searching for job site links and keywords on career page:', careerPageUrl);
    
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
          result.score += 25; // Add 25 points for each job site link found
          break;
        }
      }
    }
    
    // Get all text content of the page
    const pageText = document.body.textContent.toLowerCase();
    
    // Look for common job-related keywords
    const commonKeywords = ['job', 'career', 'position', 'vacancy', 'opportunity', 'employment', 
                          'hiring', 'apply', 'application', 'join us', 'join our team'];
    
    for (const keyword of commonKeywords) {
      if (pageText.includes(keyword)) {
        result.keywords.push(keyword);
        result.score += 5; // Add 5 points for each common job keyword found
      }
    }
    
    // Look for user-defined keywords (more valuable), but don't include them in results per user request
    if (Array.isArray(searchKeywords) && searchKeywords.length > 0) {
      console.log(`Scanning career page for ${searchKeywords.length} user-defined keywords`);
      
      for (const keyword of searchKeywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageText.includes(keywordLower)) {
          console.log(`Found user keyword on career page: ${keyword}`);
          // Still award points, but don't add to userKeywords array per user request
          result.score += 20; // Add 20 points for each user-defined keyword found
        }
      }
      
      console.log(`Processed ${searchKeywords.length} user-defined keywords on career page`);
    }
    
    // Look for job-specific keywords (highest scoring)
    if (Array.isArray(jobKeywords) && jobKeywords.length > 0) {
      console.log(`Scanning career page for ${jobKeywords.length} job-specific keywords`);
      
      for (const keyword of jobKeywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageText.includes(keywordLower)) {
          console.log(`Found job-specific keyword on career page: ${keyword}`);
          result.jobSpecificKeywords.push(keyword);
          result.potential_job_match = true; // Mark as potential job match
          result.score += 40; // Add 40 points for each job-specific keyword found
        }
      }
      
      console.log(`Found ${result.jobSpecificKeywords.length} job-specific keywords on career page`);
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
          // Execute script to find job site links and keywords
          chrome.scripting.executeScript({
            target: { tabId },
            function: searchForJobSiteLinks,
            args: [
              careerPageUrl, 
              searchData.keywords || [], 
              searchData.jobKeywords || [] // Also pass the job-specific keywords
            ]
          }).then(results => {
            if (results && results[0] && results[0].result) {
              const careerPageResults = results[0].result;
              console.log(`Found on career page:`, careerPageResults);
              
              // Update parent score based on career page scan results
              if (careerPageResults.score > 0) {
                parentResult.score += Math.min(careerPageResults.score, 50); // Add up to 50 more points max
                console.log(`Updated score from career page scan: +${Math.min(careerPageResults.score, 50)} points`);
              }
              
              // Don't add user-defined keywords to parent result as per user request
              // We previously awarded points for these in searchForJobSiteLinks
              
              // Add job-specific keywords if found
              if (careerPageResults.jobSpecificKeywords && careerPageResults.jobSpecificKeywords.length > 0) {
                console.log(`Found ${careerPageResults.jobSpecificKeywords.length} job-specific keywords on career page`);
                
                // Initialize jobSpecificKeywords array if needed
                if (!parentResult.jobSpecificKeywords) {
                  parentResult.jobSpecificKeywords = [];
                }
                
                // Add job-specific keywords to parent result
                for (const keyword of careerPageResults.jobSpecificKeywords) {
                  if (!parentResult.jobSpecificKeywords.includes(keyword)) {
                    parentResult.jobSpecificKeywords.push(keyword);
                  }
                }
              }
              
              // Add any found job-specific keywords to the parent result
              if (careerPageResults.jobSpecificKeywords && careerPageResults.jobSpecificKeywords.length > 0) {
                console.log(`Found ${careerPageResults.jobSpecificKeywords.length} job-specific keywords on career page`);
                
                // Initialize the jobSpecificKeywords array if it doesn't exist
                if (!parentResult.jobSpecificKeywords) {
                  parentResult.jobSpecificKeywords = [];
                }
                
                // Update potential job match if found in career page
                if (careerPageResults.potential_job_match) {
                  parentResult.potential_job_match = true;
                }
                
                // Add the job-specific keywords
                for (const keyword of careerPageResults.jobSpecificKeywords) {
                  if (!parentResult.jobSpecificKeywords.includes(keyword)) {
                    parentResult.jobSpecificKeywords.push(keyword);
                  }
                  
                  // Also add to regular jobKeywords for backward compatibility
                  if (!parentResult.jobKeywords.includes(keyword)) {
                    parentResult.jobKeywords.push(keyword);
                  }
                }
              }
              
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
                    jobSiteLinks: parentResult.jobSiteLinks,
                    jobKeywords: parentResult.jobKeywords,  // Include updated job keywords
                    potential_job_match: parentResult.potential_job_match // Include potential job match flag
                  };
                  
                  // Update the cache with the enhanced result
                  cacheWebsiteResult(parentWebsite.website, {
                    ...parentResult,
                    score: parentResult.score,
                    jobSiteLinks: parentResult.jobSiteLinks,
                    jobKeywords: parentResult.jobKeywords,  // Include updated job keywords
                    potential_job_match: parentResult.potential_job_match // Include potential job match flag
                  });
                  
                  // Update in search results if already present
                  for (let i = 0; i < searchResults.length; i++) {
                    if (searchResults[i].website === parentWebsite.website) {
                      searchResults[i] = {
                        ...searchResults[i],
                        score: parentResult.score,
                        jobSiteLinks: parentResult.jobSiteLinks,
                        jobKeywords: parentResult.jobKeywords,
                        potential_job_match: parentResult.potential_job_match
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
