document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const keywordsInput = document.getElementById('keywords');
  const jobKeywordsInput = document.getElementById('job-keywords');
  const locationInput = document.getElementById('location');
  const websiteKeywordsInput = document.getElementById('website-keywords');
  const maxResultsInput = document.getElementById('max-results');
  const resetWebsiteKeywordsButton = document.getElementById('reset-website-keywords');
  const startSearchButton = document.getElementById('start-search');
  const cancelSearchButton = document.getElementById('cancel-search');
  const resultsContainer = document.getElementById('results-container');
  const statusMessage = document.getElementById('status-message');
  const progressBar = document.getElementById('progress-bar');
  const resultsList = document.getElementById('results-list');
  const exportCsvButton = document.getElementById('export-csv');
  const settingsButton = document.getElementById('settings-button');
  
  let allResults = []; // Store all results for CSV export
  
  // Check if we're coming back from the settings page with a preserveState flag
  const urlParams = new URLSearchParams(window.location.search);
  const preserveState = urlParams.get('preserveState') === 'true';
  
  // Default website keywords that will be used if none are specified
  const DEFAULT_WEBSITE_KEYWORDS = [
    'job', 'jobs', 'career', 'careers', 'work', 'vacancy', 'vacancies',
    'hire', 'hiring', 'apply', 'application', 'position', 'spontaneous',
    'opportunity', 'employment', 'recruitment', 'join us', 'join our team',
  ];
  
  // Initialize the website keywords immediately with defaults
  websiteKeywordsInput.value = DEFAULT_WEBSITE_KEYWORDS.join(', ');
  
  // Save default keywords to storage if they don't exist yet
  chrome.storage.local.get(['websiteKeywords'], function(data) {
    console.log("Loaded website keywords from storage:", data.websiteKeywords);
    
    if (!data.websiteKeywords || data.websiteKeywords.trim() === '') {
      // No stored keywords, use and save defaults
      console.log("No website keywords found in storage, saving defaults");
      chrome.storage.local.set({
        websiteKeywords: DEFAULT_WEBSITE_KEYWORDS.join(', ')
      });
    } else {
      // Update the input with saved keywords from storage
      console.log("Using website keywords from storage");
      websiteKeywordsInput.value = data.websiteKeywords;
    }
  });
  
  // Connect to the background script to detect popup closure
  const port = chrome.runtime.connect({ name: 'popup' });
  
  // Notify the background script that the popup is open
  chrome.runtime.sendMessage({ action: 'popupOpened' });
  
  // Save state before popup closes (including when links are clicked)
  window.addEventListener('beforeunload', function() {
    saveSearchState();
  });
  
  // Capture any clicks on links that might open in new tabs
  document.body.addEventListener('click', function(e) {
    // Look for link clicks that might close the popup
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      const link = e.target.tagName === 'A' ? e.target : e.target.closest('a');
      
      // If this is an external link (has href and target="_blank" or opens in new tab)
      if (link.href && (link.target === '_blank' || link.getAttribute('rel') === 'noopener')) {
        // Save state before the popup closes due to opening a new tab
        saveSearchState();
        
        // Set a flag in sessionStorage indicating we're coming back from an external link
        try {
          sessionStorage.setItem('gmjs_return_from_link', 'true');
        } catch (e) {
          console.error('Error setting return flag in session storage:', e);
        }
      }
    }
  }, true);
  
  // If we're returning from settings or from an external link, restore state
  if (preserveState || sessionStorage.getItem('gmjs_return_from_link') === 'true') {
    // Clear the return flag
    sessionStorage.removeItem('gmjs_return_from_link');
    
    // Restore search state from storage immediately
    restoreSearchState();
    // Remove the preserveState parameter from URL to avoid state confusion on refresh
    window.history.replaceState({}, document.title, 'popup.html');
  } else {
    // Regular startup flow: check for running search
    checkForRunningSearch();
  }
  
  // Check if there's a running search when popup opens
  function checkForRunningSearch() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
        // First check via scripting API if search is in progress
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          function: () => {
            return {
              searchInProgress: sessionStorage.getItem('gmjs_search_in_progress') === 'true',
              searchCompleted: sessionStorage.getItem('gmjs_searchCompleted') === 'true',
              status: sessionStorage.getItem('gmjs_contentStatus'),
              progress: sessionStorage.getItem('gmjs_contentProgress'),
              searchData: sessionStorage.getItem('gmjs_searchData')
            };
          }
        }).then(results => {
          if (results && results[0]?.result) {
            console.log('Search state from session storage:', results[0].result);
            
            // Check if search is in progress based on session storage
            const searchInProgress = results[0].result.searchInProgress;
            // Check if search is completed based on session storage
            const searchCompleted = results[0].result.searchCompleted === 'true';
            
            // If search is in progress, update UI accordingly
            if (searchInProgress && !searchCompleted) {
              console.log('Search is in progress, showing cancel button');
              // Update UI to show search in progress
              updateSearchButtonStates(true);
              
              // Show status and progress if available
              if (results[0].result.status) {
                statusMessage.textContent = results[0].result.status;
                resultsContainer.classList.remove('hidden');
              }
              
              if (results[0].result.progress) {
                progressBar.style.width = results[0].result.progress + '%';
              }
              
              // Restore any search parameters
              restoreSearchState();
              return;
            }
          }
          
          // Fall back to the message approach if script execution didn't find an active search
          chrome.tabs.sendMessage(currentTab.id, { action: 'popupOpened' }, function(response) {
            if (chrome.runtime.lastError) {
              console.error('Error checking search status:', chrome.runtime.lastError);
              // If we can't communicate with content script, try to get results from background
              fetchResultsFromBackground();
              return;
            }
            
            console.log('Received popup opened response:', response);
            
            if (response) {
              // Check for completed search flag first
              if (response.searchCompleted) {
                console.log('Found completed search state, showing start button');
                // If search is completed, show start button and restore results
                updateSearchButtonStates(false);
                
                // Check if the content script provided final results
                if (response.finalResults && Array.isArray(response.finalResults) && response.finalResults.length > 0) {
                  console.log(`Using ${response.finalResults.length} final results directly from content script`);
                  
                  // Clear existing results
                  allResults = [];
                  resultsList.innerHTML = '';
                  
                  // Add final results from content script
                  response.finalResults.forEach(result => {
                    if (!allResults.some(existing => existing.website === result.website)) {
                      allResults.push(result);
                      addResultToList(result);
                    }
                  });
                  
                  // Show results container and status
                  resultsContainer.classList.remove('hidden');
                  statusMessage.textContent = 'Search completed!';
                  progressBar.style.width = '100%';
                  
                  // Save these results to local storage for future access
                  chrome.storage.local.set({
                    'popupResults': allResults,
                    'popupStatus': 'Search completed!',
                    'popupProgress': '100%',
                    'searchCompletedTimestamp': response.searchCompletedTimestamp || Date.now()
                  });
                  
                  // Enable export button
                  exportCsvButton.disabled = allResults.length === 0;
                } else {
                  // If no final results in content script, fetch from background
                  fetchResultsFromBackground();
                }
              }
              // Only check for inProgress if search is not completed
              else if (response.inProgress) {
                console.log('Search is in progress, showing cancel button');
                // If search is in progress, enable cancel button and disable start button
                updateSearchButtonStates(true);
                
                // Restore search state UI
                restoreSearchState();
              } else {
                // If no search is in progress or completed, check if we have a saved state
                console.log('No active search, checking for previous results');
                fetchResultsFromBackground();
              }
            } else {
              // No response, fall back to background results
              fetchResultsFromBackground();
            }
          });
        });
      } else {
        // Not on Google Maps, check if we have saved results
        fetchResultsFromBackground();
      }
    });
  }
  
  // Function to fetch search results from background script
  function fetchResultsFromBackground() {
    // Log that we're fetching results
    console.log('[DEBUG] Fetching results from background script...');
    
    // First check if we have any final results in session storage
    // This handles the case where the popup is opened immediately after search completion
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
        console.log('[DEBUG] On Google Maps page, checking session storage for final results');
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          function: () => {
            try {
              // Check for final results in session storage
              const finalResultsStr = sessionStorage.getItem('gmjs_finalResults');
              if (finalResultsStr) {
                try {
                  const finalResults = JSON.parse(finalResultsStr);
                  if (Array.isArray(finalResults) && finalResults.length > 0) {
                    return {
                      hasFinalResults: true,
                      finalResults: finalResults,
                      timestamp: sessionStorage.getItem('gmjs_searchCompletedTimestamp')
                    };
                  }
                } catch (parseErr) {
                  console.error('Error parsing final results:', parseErr);
                }
              }
              return { hasFinalResults: false };
            } catch (e) {
              console.error('Error retrieving final results from session storage:', e);
              return { hasFinalResults: false, error: e.message };
            }
          }
        }).then(results => {
          if (results && results[0]?.result?.hasFinalResults && results[0].result.finalResults) {
            console.log(`Found ${results[0].result.finalResults.length} final results in session storage`);
            
            // Use these results directly - they're the freshest available
            const finalResults = results[0].result.finalResults;
            const timestamp = results[0].result.timestamp ? parseInt(results[0].result.timestamp) : Date.now();
            
            // Clear and display results
            allResults = [];
            resultsList.innerHTML = '';
            
            finalResults.forEach(result => {
              if (!allResults.some(existing => existing.website === result.website)) {
                // Make sure jobSpecificKeywords is always an array
                if (!result.jobSpecificKeywords) {
                  console.log(`Initializing empty jobSpecificKeywords for ${result.website} from session storage`);
                  result.jobSpecificKeywords = [];
                } else {
                  console.log(`Loaded ${result.jobSpecificKeywords.length} jobSpecificKeywords for ${result.website} from session storage: ${result.jobSpecificKeywords.join(', ')}`);
                }
                
                // Ensure potential_job_match is initialized
                if (result.potential_job_match === undefined) {
                  result.potential_job_match = false;
                }
                allResults.push(result);
                addResultToList(result);
              }
            });
            
            // Update local storage with these results
            chrome.storage.local.set({
              'popupResults': allResults,
              'popupStatus': 'Search completed!',
              'popupProgress': '100%',
              'searchCompletedTimestamp': timestamp
            });
            
            // Show the results container and set status
            resultsContainer.classList.remove('hidden');
            statusMessage.textContent = 'Search completed!';
            progressBar.style.width = '100%';
            
            // Set correct button state
            updateSearchButtonStates(false);
            
            // Enable export button
            exportCsvButton.disabled = allResults.length === 0;
            
            // We're done, no need to proceed to background script query
            return;
          }
          
          // Proceed to background query if no session storage results
          proceedToBackgroundQuery();
        }).catch(error => {
          console.error('Error executing script to retrieve final results:', error);
          proceedToBackgroundQuery();
        });
      } else {
        // Not on Google Maps, just query background
        proceedToBackgroundQuery();
      }
    });
    
    function proceedToBackgroundQuery() {
      // Request both search results and completion timestamp
      chrome.runtime.sendMessage({ 
        action: 'getSearchResults',
        includeTimestamps: true,
        forceLatestResults: true
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error fetching search results:', chrome.runtime.lastError);
          // Try local popup state instead
          checkForPopupResults();
          return;
        }
        
        if (response) {
          console.log('Retrieved search state from background:', 
            `${response.results ? response.results.length : 0} results, ` +
            `status: ${response.status}, ` +
            `completed: ${response.searchCompletedTimestamp ? 'yes' : 'no'}`
          );
          
          // First check if we have any results or are still processing
          if ((response.results && response.results.length > 0) || 
              (response.websiteProcessingQueue && response.websiteProcessingQueue.length > 0)) {
            
            displayBackgroundResults(response);
          } else {
            // If no results from background, check if we have saved popup results
            checkForPopupResults();
          }
        } else {
          // If no response, check for popup results
          checkForPopupResults();
        }
      });
    }
  }
  
  
  // Function to check for popup-specific saved results
  function checkForPopupResults() {
    // First try to get the precise content status from session storage via content script
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
        chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          function: () => {
            try {
              return {
                status: sessionStorage.getItem('gmjs_contentStatus'),
                progress: sessionStorage.getItem('gmjs_contentProgress'),
                searchCompleted: sessionStorage.getItem('gmjs_searchCompleted'),
                searchCompletedTimestamp: sessionStorage.getItem('gmjs_searchCompletedTimestamp')
              };
            } catch (e) {
              console.error('Error retrieving status from session storage:', e);
              return null;
            }
          }
        }).then(results => {
          if (results && results[0]?.result) {
            console.log('Retrieved status from content script session storage:', results[0].result);
            
            // Show the results container
            resultsContainer.classList.remove('hidden');
            
            // Set status and progress from session storage (most accurate)
            if (results[0].result.status) {
              statusMessage.textContent = results[0].result.status;
            }
            
            if (results[0].result.progress) {
              progressBar.style.width = results[0].result.progress + '%';
            }
            
            // Check for the completion flag - this takes precedence over everything else
            const isSearchCompleted = results[0].result.searchCompleted === 'true' || 
                                      (results[0].result.status && results[0].result.status.includes('complete'));
            
            if (isSearchCompleted) {
              console.log('Search was completed, showing start button');
              updateSearchButtonStates(false);
              
              // Continue to load results from local storage, but don't let it change the button state
              checkLocalStorageResultsWithoutButtonUpdate();
              return;
            }
            
            // Only proceed to check local storage for button state if no completion flag was found
            checkLocalStorageResults();
          } else {
            // Fall back to local storage if no session storage data
            checkLocalStorageResults();
          }
        }).catch(error => {
          console.error('Error executing script to retrieve status:', error);
          checkLocalStorageResults();
        });
      } else {
        // Not on Google Maps, just check local storage
        checkLocalStorageResults();
      }
    });
  }
  
  // Function that checks local storage but doesn't update button state
  // This is used when we've already determined the button state from session storage
  function checkLocalStorageResultsWithoutButtonUpdate() {
    chrome.storage.local.get(['popupResults', 'popupStatus', 'popupProgress'], function(data) {
      if (data.popupResults && data.popupResults.length > 0) {
        console.log('Retrieved popup-specific saved results but keeping current button state');
        
        // Only update status/progress if not already set by session storage
        if (!statusMessage.textContent || statusMessage.textContent === 'Initializing...') {
          statusMessage.textContent = data.popupStatus || 'Previous search results';
          progressBar.style.width = data.popupProgress || '100%';
        }
        
        // Clear any existing results
        resultsList.innerHTML = '';
        
        // Set results
        allResults = data.popupResults;
        
        // Display results
        allResults.forEach(result => {
          addResultToList(result);
        });
        
        // Enable export button if we have results
        exportCsvButton.disabled = allResults.length === 0;
      }
    });
  }
  
  // Helper function to check local storage for saved results
  function checkLocalStorageResults() {
    chrome.storage.local.get(['popupResults', 'popupStatus', 'popupProgress', 'searchResults', 'searchStatus', 'processingInProgress', 'searchCompletedTimestamp', 'lastUpdated'], function(data) {
      if (data.popupResults && data.popupResults.length > 0) {
        console.log('Retrieved popup-specific saved results:', data);
        
        // Show the results container
        resultsContainer.classList.remove('hidden');
        
        // Determine the correct status to show
        let correctStatus = 'Search completed!';
        let correctProgress = '100%';
        
        // First check if we have the search completed flag in session storage
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
            chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              function: () => {
                try {
                  return {
                    searchCompleted: sessionStorage.getItem('gmjs_searchCompleted'),
                    searchCompletedTimestamp: sessionStorage.getItem('gmjs_searchCompletedTimestamp')
                  };
                } catch (e) {
                  console.error('Error retrieving completed flag from session storage:', e);
                  return { searchCompleted: null, searchCompletedTimestamp: null };
                }
              }
            }).then(results => {
              const sessionStorageCompleted = results && results[0]?.result?.searchCompleted === 'true';
              const sessionStorageTimestamp = results && results[0]?.result?.searchCompletedTimestamp ? 
                parseInt(results[0].result.searchCompletedTimestamp) : 0;
              const localStorageTimestamp = data.searchCompletedTimestamp || 0;
              
              console.log('Search completion timestamps - Session:', sessionStorageTimestamp, 'Local:', localStorageTimestamp);
              
              // Use the most recent completed state based on timestamps
              if (sessionStorageCompleted && (sessionStorageTimestamp >= localStorageTimestamp)) {
                console.log('Using session storage completion state (more recent)');
                setCompletedState();
              } else if (data.searchCompletedTimestamp) {
                console.log('Using local storage completion state (more recent)');
                setCompletedState();
              } else {
                // If neither has a valid timestamp, fall back to local storage logic
                checkLocalStorageFallback();
              }
            }).catch(err => {
              console.error('Error executing script to check completed status:', err);
              checkLocalStorageFallback();
            });
          } else {
            // Not on Google Maps, use local storage fallback
            checkLocalStorageFallback();
          }
        });
        
        // Fallback function to determine status from local storage
        function checkLocalStorageFallback() {
          // Check if search completed according to the timestamp
          const hasCompletionTimestamp = data.searchCompletedTimestamp !== undefined && 
                                        data.searchCompletedTimestamp !== null;
          
          // Check if search is still in progress according to background script
          const isStillProcessing = data.processingInProgress === true && 
                                   !(data.searchStatus === 'complete' || data.searchStatus === 'cancelled') &&
                                   !hasCompletionTimestamp;
          
          // If we have a completion timestamp, the search is definitely complete
          if (hasCompletionTimestamp) {
            correctStatus = 'Search completed!';
            setStatus(correctStatus, false);
            return;
          }
          
          // If a search was previously completed, never show "Starting to process..." message
          // This prevents the "stuck" message issue when refreshing the page
          if (data.popupStatus && data.popupStatus.includes('Starting to process')) {
            correctStatus = 'Search completed!';
          } else if (!isStillProcessing) {
            // Search is completed, override any "in progress" status that was saved
            correctStatus = 'Search completed!';
          } else if (data.popupStatus) {
            // Use saved status 
            correctStatus = data.popupStatus;
          }
          
          setStatus(correctStatus, isStillProcessing);
        }
        
        // Helper function to set completed state
        function setCompletedState() {
          correctStatus = 'Search completed!';
          setStatus(correctStatus, false);
        }
        
        // Helper function to set the status and update UI
        function setStatus(status, isStillProcessing) {
          // Set status and progress
          statusMessage.textContent = status;
          progressBar.style.width = isStillProcessing ? (data.popupProgress || '50%') : '100%';
          
          // Clear any existing results
          resultsList.innerHTML = '';
          
          // Set results
          allResults = data.popupResults;
          
          // Display results
          allResults.forEach(result => {
            addResultToList(result);
          });
          
          // Enable export button if we have results
          exportCsvButton.disabled = allResults.length === 0;
          
          // Update button states based on status text - expanded check for completed status
          const isSearchCompleted = 
            !isStillProcessing || 
            (data.popupStatus || '').toLowerCase().includes('complete') || 
            (data.popupStatus || '').toLowerCase().includes('cancel') ||
            (data.popupStatus || '').toLowerCase().includes('finished') ||
            (statusMessage.textContent || '').toLowerCase().includes('complete') ||
            (statusMessage.textContent || '').toLowerCase().includes('cancel') ||
            (statusMessage.textContent || '').toLowerCase().includes('finished') ||
            (data.popupProgress === '100%') ||
            (progressBar.style.width === '100%');
            
          // If search is completed, we should show the start button
          updateSearchButtonStates(!isSearchCompleted);
        }
      }
    });
  }
  
  // Function to display results from background script
  function displayBackgroundResults(response) {
    // Show the results container
    resultsContainer.classList.remove('hidden');
    
    let isProcessing = false; // Flag to track if search is still in progress
    
    // Check for completion timestamp first as it's the most reliable indicator
    const hasCompletionTimestamp = response.searchCompletedTimestamp !== undefined && 
                                  response.searchCompletedTimestamp !== null;
                                  
    // Handle different search statuses
    if (hasCompletionTimestamp || response.status === 'complete') {
      statusMessage.textContent = 'Search completed!';
      progressBar.style.width = '100%';
    } else if (response.status === 'processing') {
      // First check if we have a detailed status message
      if (response.detailedStatusMessage) {
        statusMessage.textContent = response.detailedStatusMessage;
      } else {
        statusMessage.textContent = 'Search in progress...';
      }
      
      isProcessing = true; // Set the flag since the search is still running
      
      // Calculate progress based on processing queue
      if (response.websiteProcessingQueue && response.websiteProcessingQueue.length > 0) {
        const processedCount = response.websiteProcessingQueue.filter(site => site.processed).length;
        const totalCount = response.websiteProcessingQueue.length;
        const progress = 50 + ((processedCount / totalCount) * 50);
        
        progressBar.style.width = progress + '%';
        
        if (processedCount < totalCount) {
          // If we don't have a detailed status message, create one based on queue info
          if (!response.detailedStatusMessage) {
            statusMessage.textContent = `Processing website ${processedCount} of ${totalCount}...`;
          }
          isProcessing = true; // Explicitly mark as processing if we have unprocessed sites
        } else {
          statusMessage.textContent = 'Processing complete';
        }
      } else {
        progressBar.style.width = '50%';
        if (response.processingInProgress) {
          isProcessing = true; // Rely on the explicit processingInProgress flag
        }
      }
    } else {
      statusMessage.textContent = 'Previous search results';
      progressBar.style.width = '100%';
    }

    // Explicitly check the processingInProgress flag from the background
    // But override it if we have a completion timestamp
    if (response.searchCompletedTimestamp) {
      isProcessing = false;
      console.log('Found completion timestamp, search is definitely complete');
    } else if (response.processingInProgress === true) {
      isProcessing = true;
      console.log('Background indicates search is still in progress');
    }
    
    // Update button states based on processing status
    updateSearchButtonStates(isProcessing);
    
    // Clear any existing results
    resultsList.innerHTML = '';
    
    // Log the results count for debugging
    console.log(`Displaying background results: ${(response.results || []).length} results, timestamp: ${response.searchCompletedTimestamp || 'none'}`);
    
    // Combine results from both completed results and in-progress items in the queue
    allResults = [...(response.results || [])];
    
    if (allResults.length === 0) {
      console.log('No results found in response.results, checking other sources...');
    }
    
    // Check if there are any items in the processing queue that should be displayed
    if (response.websiteProcessingQueue && response.websiteProcessingQueue.length > 0) {
      console.log(`Found ${response.websiteProcessingQueue.length} items in processing queue`);
      
      // Find queue items that have some information but might not be in the results array yet
      response.websiteProcessingQueue.forEach(queueItem => {
        // Check if this item is not already in allResults
        const isAlreadyInResults = allResults.some(result => result.website === queueItem.website);
        
        // If not in results but has some processed data, add it
        if (!isAlreadyInResults && queueItem.processed) {
          // Check if it has any data worth showing (job keywords, contact info, etc.)
          if ((queueItem.jobKeywords && queueItem.jobKeywords.length > 0) || 
              queueItem.contactEmail || queueItem.contactPage ||
              (queueItem.jobListings && queueItem.jobListings.length > 0) ||
              queueItem.timedOut) {
            
            // Add to results for display
            allResults.push({
              businessName: queueItem.businessName || "Unknown Business",
              address: queueItem.address || "",
              website: queueItem.website,
              jobKeywords: queueItem.jobKeywords || [],
              jobSpecificKeywords: queueItem.jobSpecificKeywords || [], // Ensure this field is included
              potential_job_match: queueItem.potential_job_match || false, // Include potential job match
              contactEmail: queueItem.contactEmail,
              contactPage: queueItem.contactPage,
              jobPages: queueItem.jobPages || [],
              jobListings: queueItem.jobListings || [],
              score: queueItem.score || 0,
              lastChecked: queueItem.lastChecked,
              timedOut: queueItem.timedOut || false
            });
          }
        }
      });
    }
    
    // Ensure all results have jobSpecificKeywords properly initialized
    allResults.forEach(result => {
      if (!result.jobSpecificKeywords) {
        console.log(`[DEBUG] Initializing empty jobSpecificKeywords for ${result.website} in displayBackgroundResults`);
        result.jobSpecificKeywords = [];
      } else {
        console.log(`[DEBUG] Found ${result.jobSpecificKeywords.length} jobSpecificKeywords for ${result.website} in background results: ${result.jobSpecificKeywords.join(', ')}`);
      }
      
      // Ensure potential_job_match is initialized
      if (result.potential_job_match === undefined) {
        result.potential_job_match = false;
      }
    });
    
    // Display each result
    allResults.forEach(result => {
      addResultToList(result);
    });
    
    // Enable export button if we have results
    exportCsvButton.disabled = allResults.length === 0;
    
    // If we still don't have results but there are some in storage, try to load them
    if (allResults.length === 0) {
      console.log('No results after processing queue, checking popupResults in storage');
      chrome.storage.local.get(['popupResults'], function(data) {
        if (data.popupResults && data.popupResults.length > 0) {
          console.log(`Found ${data.popupResults.length} results in popupResults storage`);
          allResults = data.popupResults;
          
          // Ensure all results have jobSpecificKeywords properly initialized
          allResults.forEach(result => {
            if (!result.jobSpecificKeywords) {
              console.log(`[DEBUG] Initializing empty jobSpecificKeywords for ${result.website} from popupResults storage`);
              result.jobSpecificKeywords = [];
            } else {
              console.log(`[DEBUG] Found ${result.jobSpecificKeywords.length} jobSpecificKeywords for ${result.website} in popupResults: ${result.jobSpecificKeywords.join(', ')}`);
            }
            
            // Ensure potential_job_match is initialized
            if (result.potential_job_match === undefined) {
              result.potential_job_match = false;
            }
          });
          
          // Display these results
          allResults.forEach(result => {
            addResultToList(result);
          });
          
          // Enable export button
          exportCsvButton.disabled = false;
        }
      });
    }
    
    // When we have results in the background, also save them to popup-specific storage
    // This ensures we have a fallback copy
    if (allResults.length > 0) {
      chrome.storage.local.set({
        'popupResults': allResults,
        'popupStatus': statusMessage.textContent,
        'popupProgress': progressBar.style.width,
        'searchCompletedTimestamp': response.searchCompletedTimestamp || null
      });
    }
  }
  
  // Function to save search state before navigating away
  function saveSearchState() {
    // Only save if results container is visible (search was started)
    if (!resultsContainer.classList.contains('hidden')) {
      const searchState = {
        status: statusMessage.textContent,
        progress: progressBar.style.width,
        results: allResults,
        visible: true
      };
      
      // Save to session storage for popup reopening
      chrome.storage.session.set({ 'searchState': searchState });
      
      // Also save results to local storage to ensure they're always available
      // This helps when session storage is cleared or unavailable
      chrome.storage.local.set({
        'popupResults': allResults,
        'popupStatus': statusMessage.textContent,
        'popupProgress': progressBar.style.width
      });
    }
  }
  
  // Function to check if we have a saved search state
  function checkForSavedSearchState() {
    chrome.storage.session.get(['searchState'], function(data) {
      if (data.searchState) {
        restoreSearchState(data.searchState);
      } else {
        // If no session state, try from local storage (background)
        fetchResultsFromBackground();
      }
    });
  }
  
  // Function to restore search state from saved data
  function restoreSearchState(savedState) {
    // If no state passed, get it from storage
    if (!savedState) {
      chrome.storage.session.get(['searchState'], function(data) {
        if (data.searchState) {
          applySearchState(data.searchState);
        } else {
          // If no session state, try from local storage (background)
          fetchResultsFromBackground();
        }
      });
    } else {
      applySearchState(savedState);
    }
  }
  
  // Function to apply the saved search state to the UI
  function applySearchState(state) {
    if (state.visible) {
      resultsContainer.classList.remove('hidden');
      statusMessage.textContent = state.status;
      progressBar.style.width = state.progress;
      
      // Restore results
      resultsList.innerHTML = ''; // Clear current results
      allResults = state.results || [];
      
      // Ensure all results have jobSpecificKeywords properly initialized
      allResults.forEach(result => {
        if (!result.jobSpecificKeywords) {
          console.log(`Initializing empty jobSpecificKeywords for ${result.website} during restore`);
          result.jobSpecificKeywords = [];
        } else {
          console.log(`Restored ${result.jobSpecificKeywords.length} jobSpecificKeywords for ${result.website}: ${result.jobSpecificKeywords.join(', ')}`);
        }
        
        // Ensure potential_job_match is initialized
        if (result.potential_job_match === undefined) {
          result.potential_job_match = false;
        }
      });
      
      // Display restored results
      allResults.forEach(result => {
        addResultToList(result);
      });
      
      // Enable/disable export button
      exportCsvButton.disabled = allResults.length === 0;
      
      // Check for search completion status
      const isSearchCompleted = 
        statusMessage.textContent === 'Search completed!' || 
        statusMessage.textContent.includes('cancelled') ||
        statusMessage.textContent.includes('complete') ||
        state.status === 'Search completed!' ||
        state.progress === '100%' ||
        sessionStorage.getItem('gmjs_searchCompleted') === 'true';
        
      // Update button states based on search status
      updateSearchButtonStates(!isSearchCompleted);
    }
  }

  // Settings button click handler
  settingsButton.addEventListener('click', function() {
    console.log('Settings button clicked');
    
    // Save current state
    saveSearchState();
    
    // Navigate to settings page within the same popup window
    window.location.href = 'settings.html';
  });
  
  // Function to update search and cancel button states
  function updateSearchButtonStates(isSearchInProgress) {
    if (isSearchInProgress) {
      startSearchButton.style.display = 'none';
      cancelSearchButton.style.display = 'block';
    } else {
      startSearchButton.style.display = 'block';
      cancelSearchButton.style.display = 'none';
    }
  }
  
  // Add event listener for the cancel search button
  cancelSearchButton.addEventListener('click', function() {
    // Update UI immediately to provide feedback
    statusMessage.textContent = 'Cancelling search...';
    
    // Clear results
    allResults = [];
    resultsList.innerHTML = '';
    
    // Disable export button
    exportCsvButton.disabled = true;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      // First clear our local storage state
      chrome.storage.session.remove(['searchState'], function() {
        console.log('Search state cleared from session storage');
      });
      
      // Also clear any local storage search state
      chrome.storage.local.remove([
        'searchResults', 
        'searchStatus', 
        'websiteProcessingQueue', 
        'processingInProgress',
        'lastUpdated',
        // Also clear popup-specific state
        'popupResults',
        'popupStatus',
        'popupProgress'
      ], function() {
        console.log('Search state cleared from local storage');
      });
      
      // Then send cancellation message to content script
      chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelSearch' }, function(response) {
        // Handle potential error (tab might not be available)
        if (chrome.runtime.lastError) {
          console.error('Error sending cancel message:', chrome.runtime.lastError);
          
          // Send direct cancellation to background script as fallback
          chrome.runtime.sendMessage({ action: 'cancelSearch' }, function() {
            updateSearchButtonStates(false);
            statusMessage.textContent = 'Search cancelled. You can start a new search.';
          });
          return;
        }
        
        if (response && response.status === 'search_cancelled') {
          // Update button states
          updateSearchButtonStates(false);
          statusMessage.textContent = 'Search cancelled. You can start a new search.';
          progressBar.style.width = '0%';
        }
      });
    });
  });
  
  // Then load saved settings
  chrome.storage.local.get(['keywords', 'jobKeywords', 'location', 'maxResults'], function(data) {
    if (data.keywords) keywordsInput.value = data.keywords;
    if (data.jobKeywords) jobKeywordsInput.value = data.jobKeywords;
    if (data.location) locationInput.value = data.location;
    if (data.maxResults) maxResultsInput.value = data.maxResults;
    
    // Note: websiteKeywords are loaded separately at the top of the file
    console.log("Loaded general settings from storage");
  });
  
  // Save settings when inputs change
  function saveSettings() {
    chrome.storage.local.set({
      keywords: keywordsInput.value,
      location: locationInput.value,
      maxResults: maxResultsInput.value
    });
  }
  
  // Save job keywords separately
  function saveJobKeywords() {
    chrome.storage.local.set({
      jobKeywords: jobKeywordsInput.value
    });
  }
  
  // Save max results separately
  function saveMaxResults() {
    chrome.storage.local.set({
      maxResults: maxResultsInput.value
    });
  }
  
  // Save website keywords separately
  function saveWebsiteKeywords() {
    // If the input is empty, use the defaults
    const valueToSave = websiteKeywordsInput.value.trim() !== '' 
      ? websiteKeywordsInput.value 
      : DEFAULT_WEBSITE_KEYWORDS.join(', ');
      
    // Always use the value we're saving (could be different from input)
    websiteKeywordsInput.value = valueToSave;
    
    chrome.storage.local.set({
      websiteKeywords: valueToSave
    });
  }
  
  keywordsInput.addEventListener('change', saveSettings);
  locationInput.addEventListener('change', saveSettings);
  jobKeywordsInput.addEventListener('change', saveJobKeywords);
  maxResultsInput.addEventListener('change', saveMaxResults);
  websiteKeywordsInput.addEventListener('change', saveWebsiteKeywords);
  
  // Reset website keywords to defaults
  resetWebsiteKeywordsButton.addEventListener('click', function() {
    console.log("Reset website keywords button clicked");
    
    // Get the defaults directly from the constant
    const defaultKeywords = DEFAULT_WEBSITE_KEYWORDS.join(', ');
    
    // Update UI immediately
    websiteKeywordsInput.value = defaultKeywords;
    
    // Flash effect to indicate reset
    websiteKeywordsInput.style.backgroundColor = '#e6f7ff';
    setTimeout(() => {
      websiteKeywordsInput.style.backgroundColor = '';
    }, 300);
    
    // Save the updated website keywords
    chrome.storage.local.set({
      websiteKeywords: defaultKeywords
    }, function() {
      console.log('Default website keywords restored successfully');
      alert('Website keywords have been reset to defaults!');
    });
  });
  
  // CSV Export functionality
  exportCsvButton.addEventListener('click', function() {
    if (allResults.length === 0) {
      alert('No results to export.');
      return;
    }
    
    // Create CSV content
    const csvContent = generateCsvContent(allResults);
    
    // Create a blob and download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = url;
    
    // Generate filename with current date and search keywords
    const keywords = keywordsInput.value.trim().replace(/,\s*/g, '-');
    const location = locationInput.value.trim().replace(/,\s*/g, '-') || 'no-location';
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    link.download = `google-maps-jobs-${keywords}-${location}-${date}.csv`;
    link.style.display = 'none';
    
    // Append to body, click to download, then remove
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    setTimeout(function() {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  });
  
  // Function to generate CSV content from results
  function generateCsvContent(results) {
    // Define CSV headers
    const headers = [
      'Score',
      'Business Name',
      'Address',
      'Website',
      'Job Keywords',
      'High Priority Keywords',
      'Potential Job Match',
      'Contact Email',
      'Contact Page',
      'Career Page',
      'Last Checked'
    ];
    
    // Start with headers row
    let csv = headers.map(h => escapeForCsv(h)).join(',') + '\r\n';
    
    // Sort results by score in descending order
    const sortedResults = [...results].sort((a, b) => {
      // Default score to 0 if not present
      const scoreA = typeof a.score === 'number' ? a.score : 0;
      const scoreB = typeof b.score === 'number' ? b.score : 0;
      return scoreB - scoreA;
    });
    
    // Get the search keywords to filter them
    const keywordsInput = document.getElementById('keywords');
    let searchKeywords = [];
    if (keywordsInput && keywordsInput.value) {
      searchKeywords = keywordsInput.value.split(',').map(k => k.trim().toLowerCase());
    }
    
    // Add result rows
    sortedResults.forEach(result => {
      // Filter out search keywords from job keywords
      let filteredJobKeywords = result.jobKeywords || [];
      if (searchKeywords.length > 0) {
        filteredJobKeywords = filteredJobKeywords.filter(k => 
          !searchKeywords.includes(k.toLowerCase())
        );
      }
      
      const row = [
        escapeForCsv(result.score !== undefined ? result.score : '0'),
        escapeForCsv(result.businessName || ''),
        escapeForCsv(result.address || ''),
        escapeForCsv(result.website || ''),
        escapeForCsv(filteredJobKeywords.length > 0 ? filteredJobKeywords.join('; ') : ''),
        escapeForCsv(result.jobSpecificKeywords ? result.jobSpecificKeywords.join('; ') : ''),
        escapeForCsv(result.potential_job_match ? 'Yes' : 'No'),
        escapeForCsv(result.contactEmail || ''),
        escapeForCsv(result.contactPage || ''),
        escapeForCsv(result.careerPage || ''),
        result.lastChecked ? new Date(result.lastChecked).toLocaleString() : ''
      ];
      
      csv += row.join(',') + '\r\n';
    });
    
    return csv;
  }
  
  // Helper function to escape CSV fields
  function escapeForCsv(field) {
    if (field === null || field === undefined) {
      return '';
    }
    
    // Convert the field to string and normalize special characters
    const stringValue = String(field).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/â/g, 'a') // Replace â with a
      .replace(/[^\x00-\x7F]/g, ''); // Remove non-ASCII characters
    
    // If the field contains quotes, commas, or newlines, enclose it in quotes
    // and escape any quotes inside the field
    if (/[",\n\r]/.test(stringValue)) {
      return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    
    return stringValue;
  }
  
  // Function to check if a URL is in the cache
  function checkUrlInCache(url) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['enableCache'], function(settings) {
        // If cache is disabled, no need to check
        const cacheEnabled = settings.enableCache !== false;
        if (!cacheEnabled) {
          resolve(false);
          return;
        }
        
        // Check for URL in cache
        const cacheKey = 'cached_' + btoa(url);
        chrome.storage.local.get([cacheKey], function(data) {
          resolve(!!data[cacheKey]);
        });
      });
    });
  }
  
  // Start search button click handler
  startSearchButton.addEventListener('click', function() {
    console.log("Start search button clicked");
    
    const keywords = keywordsInput.value.trim();
    if (!keywords) {
      alert('Please enter at least one keyword');
      return;
    }
    
    // Save settings first
    saveSettings();
    saveWebsiteKeywords();
    
    // Clear previous results
    allResults = []; 
    
    // Disable export button initially
    exportCsvButton.disabled = true;
    
    // Show results container and status
    resultsContainer.classList.remove('hidden');
    statusMessage.textContent = 'Initializing search...';
    progressBar.style.width = '0%';
    resultsList.innerHTML = '';
    
    // Update button states - disable start button, enable cancel button
    updateSearchButtonStates(true);
    
    // Get current tab to check if we're on Google Maps
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      
      // Check if we're on Google Maps
      if (/google\.[a-z.]+\/maps/.test(currentTab.url)) {
        // First, send a message to reset the Google Maps state programmatically
        try {
          chrome.tabs.sendMessage(
            currentTab.id, 
            { action: 'resetGoogleMaps' }, 
            function(response) {
              // Check if we got a valid response from the reset
              if (chrome.runtime.lastError) {
                console.error('Error during reset:', chrome.runtime.lastError);
                statusMessage.textContent = 'Error: Could not reset Google Maps. Please refresh the page and try again.';
                updateSearchButtonStates(false);
                return;
              }
              
              if (response && response.status === 'reset_complete') {
                console.log('Google Maps reset successfully, starting search...');
                
                // Increase the wait time after reset
                setTimeout(function() {
                  // Get website keywords
                  const websiteKeywords = websiteKeywordsInput.value.trim()
                    ? websiteKeywordsInput.value.split(',').map(k => k.trim())
                    : DEFAULT_WEBSITE_KEYWORDS;
                    
                  // Get job keywords
                  const jobKeywords = jobKeywordsInput.value.trim()
                    ? jobKeywordsInput.value.split(',').map(k => k.trim())
                    : [];
                    
                  // Set search data
                  const searchData = {
                    keywords: keywords.split(',').map(k => k.trim()),
                    location: locationInput.value.trim(),
                    websiteKeywords: websiteKeywords,
                    jobKeywords: jobKeywords, // Add job-specific keywords
                    maxResults: parseInt(maxResultsInput.value) || 20
                  };
                  
                  console.log("Sending startSearch with data:", searchData);
                  
                  chrome.tabs.sendMessage(
                    currentTab.id, 
                    {
                      action: 'startSearch',
                      data: searchData
                    }, 
                    function(searchResponse) {
                      // Check for chrome runtime errors first
                      if (chrome.runtime.lastError) {
                        console.error('Error starting search:', chrome.runtime.lastError);
                        statusMessage.textContent = 'Error: Could not start search. Please refresh the Google Maps page.';
                        updateSearchButtonStates(false);
                        return;
                      }
                      
                      console.log("Search response received:", searchResponse);
                      
                      // Check response status
                      if (searchResponse && searchResponse.status === 'started') {
                        statusMessage.textContent = 'Search started on Google Maps...';
                      } else if (searchResponse && searchResponse.status === 'error') {
                        console.error('Search error:', searchResponse.error);
                        statusMessage.textContent = `Error starting search: ${searchResponse.error}`;
                        updateSearchButtonStates(false);
                      } else if (searchResponse && searchResponse.status === 'busy') {
                        statusMessage.textContent = 'A search is already in progress.';
                        // Keep cancel button enabled as search is running
                      } else {
                        console.error('Invalid search response:', searchResponse);
                        statusMessage.textContent = 'Failed to start search. Please try again.';
                        updateSearchButtonStates(false);
                      }
                    }
                  );
                }, 3000); // Increased wait time to 3 seconds
              } else {
                // Reset failed or invalid response
                console.error('Failed to reset Google Maps:', response);
                statusMessage.textContent = 'Error: Failed to reset Google Maps. Please refresh the page and try again.';
                updateSearchButtonStates(false);
              }
            }
          );
        } catch (err) {
          console.error('Exception during reset:', err);
          statusMessage.textContent = 'Error contacting Google Maps. Please refresh the page and try again.';
          updateSearchButtonStates(false);
        }
      } else {
        // Not on Google Maps, show error and open Maps
        statusMessage.textContent = 'Please navigate to Google Maps first';
        updateSearchButtonStates(false);
        const openMapsButton = document.createElement('button');
        openMapsButton.textContent = 'Open Google Maps';
        openMapsButton.className = 'primary-button';
        openMapsButton.style.marginTop = '10px';
        
        openMapsButton.addEventListener('click', function() {
          chrome.tabs.create({url: 'https://www.google.com/maps'});
        });
        
        resultsList.appendChild(openMapsButton);
      }
    });
  });
  
  // Listen for messages from content script or background
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'updateProgress') {
      statusMessage.textContent = message.status;
      progressBar.style.width = message.progress + '%';
    } else if (message.action === 'addResult') {
      // Check if this website URL is already in the results to prevent duplicates
      const isDuplicate = allResults.some(existingResult => 
        existingResult.website === message.result.website
      );
      
      if (!isDuplicate) {
        // Add result to internal array for CSV export
        allResults.push(message.result);
        
        // Add result to the UI
        addResultToList(message.result);
        
        // Enable export button when we have results
        if (allResults.length > 0) {
          exportCsvButton.disabled = false;
        }
      } else {
        console.log('Skipping duplicate result:', message.result.website);
      }
    } else if (message.action === 'searchComplete') {
      statusMessage.textContent = 'Search completed!';
      progressBar.style.width = '100%';
      
      const completedTimestamp = message.completedTimestamp || Date.now();
      console.log('Search completed with timestamp: ' + completedTimestamp);
      
      // If final results are included, update our results array
      if (message.finalResults && Array.isArray(message.finalResults)) {
        console.log(`Received ${message.finalResults.length} final results with search completion`);
        
        // Clear existing results first
        allResults = [];
        resultsList.innerHTML = '';
        
        // Add all final results
        if (message.finalResults.length > 0) {
          message.finalResults.forEach(result => {
            // Only add if it's not a duplicate
            if (!allResults.some(existing => existing.website === result.website)) {
              allResults.push(result);
              addResultToList(result);
            }
          });
          
          console.log(`Added ${allResults.length} final results to display`);
        } else {
          console.warn('Received empty finalResults array in searchComplete message');
          
          // Try to get results from background script as a fallback
          chrome.runtime.sendMessage({ 
            action: 'getSearchResults',
            includeTimestamps: true,
            forceLatestResults: true
          }, function(response) {
            if (response && response.results && response.results.length > 0) {
              console.log(`Retrieved ${response.results.length} results from background as fallback`);
              
              // Clear again just to be safe
              allResults = [];
              resultsList.innerHTML = '';
              
              // Add results from background
              response.results.forEach(result => {
                if (!allResults.some(existing => existing.website === result.website)) {
                  allResults.push(result);
                  addResultToList(result);
                }
              });
              
              console.log(`Added ${allResults.length} results from background as fallback`);
              
              // Save these results to local storage
              saveResultsToStorage(allResults, completedTimestamp);
            }
          });
        }
        
        // Save the final results to local storage and session storage for future access
        saveResultsToStorage(allResults, completedTimestamp);
        
        // Also try to save results to session storage via content script
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
            // We need to stringify the results for session storage
            const resultsJson = JSON.stringify(message.finalResults);
            
            chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              function: (resultsJson, timestamp) => {
                try {
                  // Store the results and completion timestamp in session storage
                  sessionStorage.setItem('gmjs_finalResults', resultsJson);
                  sessionStorage.setItem('gmjs_searchCompletedTimestamp', timestamp);
                  return true;
                } catch (e) {
                  console.error('Error saving final results to session storage:', e);
                  return false;
                }
              },
              args: [resultsJson, completedTimestamp.toString()]
            }).catch(err => {
              console.error('Error executing script to save final results:', err);
            });
          }
        });
      } else {
        console.warn('No finalResults provided with searchComplete message');
        
        // If we don't have finalResults, try to get results from background
        chrome.runtime.sendMessage({ 
          action: 'getSearchResults',
          includeTimestamps: true,
          forceLatestResults: true
        }, function(response) {
          if (response && response.results && response.results.length > 0) {
            console.log(`Retrieved ${response.results.length} results from background`);
            
            // Add results from background
            allResults = [];
            resultsList.innerHTML = '';
            
            response.results.forEach(result => {
              allResults.push(result);
              addResultToList(result);
            });
            
            // Save these results
            saveResultsToStorage(allResults, completedTimestamp);
          }
        });
      }
      
      // Function to save results to storage
      function saveResultsToStorage(results, timestamp) {
        chrome.storage.local.set({
          'popupResults': results,
          'popupStatus': 'Search completed!',
          'popupProgress': '100%',
          'searchCompletedTimestamp': timestamp
        }, function() {
          console.log(`Saved ${results.length} results to storage with timestamp: ${timestamp}`);
        });
      }
      
      // Re-enable the search button when search is complete
      updateSearchButtonStates(false);
      
      // Enable export button if we have results
      exportCsvButton.disabled = allResults.length === 0;
    } else if (message.action === 'searchCancelled') {
      statusMessage.textContent = 'Search was cancelled';
      
      // Re-enable the search button when search is cancelled
      updateSearchButtonStates(false);
      
      // Save the state so we show the cancelled state on popup reopen
      if (message.searchCompletedTimestamp) {
        chrome.storage.local.set({
          'popupStatus': 'Search was cancelled',
          'popupProgress': '100%',
          'searchCompletedTimestamp': message.searchCompletedTimestamp
        });
      }
    } else if (message.action === 'updateResult') {
      // Update an existing result with new information (e.g., from job site links)
      const existingIndex = allResults.findIndex(result => 
        result.website === message.result.website
      );
      
      if (existingIndex !== -1) {
        // Ensure jobSpecificKeywords is always an array
        if (!message.result.jobSpecificKeywords) {
          console.log(`No jobSpecificKeywords in updated result for ${message.result.website}, using empty array`);
          message.result.jobSpecificKeywords = [];
        } else {
          console.log(`Received ${message.result.jobSpecificKeywords.length} jobSpecificKeywords for ${message.result.website}: ${message.result.jobSpecificKeywords.join(', ')}`);
        }
        
        // Update the result in our array
        allResults[existingIndex] = message.result;
        
        // Update the UI by replacing the result card
        const existingResultElements = Array.from(resultsList.children);
        for (let i = 0; i < existingResultElements.length; i++) {
          const resultElement = existingResultElements[i];
          const websiteLink = resultElement.querySelector('a[href="' + message.result.website + '"]');
          if (websiteLink) {
            // Replace the old result with the updated one
            const updatedResultElement = document.createElement('div');
            addResultToList(message.result, updatedResultElement);
            resultsList.replaceChild(updatedResultElement.firstChild, resultElement);
            break;
          }
        }
        
        // Save the updated results to storage to preserve them when popup reopens
        console.log('Saving updated results to storage after external search');
        
        // Get the current timestamp or use current time
        const timestamp = Date.now();
        
        // Save to local storage for persistence, including completion timestamp
        chrome.storage.local.set({
          'popupResults': allResults,
          'popupStatus': 'Search completed!',
          'popupProgress': '100%',
          'searchCompletedTimestamp': timestamp
        }, function() {
          console.log(`Saved ${allResults.length} results to local storage with timestamp: ${timestamp}`);
        });
        
        // Also update in session storage if on a Google Maps page
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes('google.com/maps')) {
            chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              function: (resultsJson, timestamp) => {
                try {
                  // Update the final results and timestamp in session storage
                  sessionStorage.setItem('gmjs_finalResults', resultsJson);
                  sessionStorage.setItem('gmjs_searchCompletedTimestamp', timestamp);
                  return true;
                } catch (e) {
                  console.error('Error updating final results in session storage:', e);
                  return false;
                }
              },
              args: [JSON.stringify(allResults), timestamp.toString()]
            }).then(() => {
              console.log('Updated session storage with latest results');
            }).catch(err => {
              console.error('Error executing script to update session storage:', err);
            });
          }
        });
      }
    }
    
    sendResponse({received: true});
    return true; // Keep the messaging channel open for async responses
  });
  
  // Function to add a result to the results list
  function addResultToList(result, container = resultsList) {
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    
    // Check if this was a cached result
    if (result.fromCache) {
      resultItem.classList.add('cached-result');
    }
    
    // Business name with website link (without score badge here)
    const header = document.createElement('div');
    header.className = 'result-header';
    
    // Business name with link
    const name = document.createElement('h3');
    if (result.website) {
      name.innerHTML = `<a href="${result.website}" target="_blank">${result.businessName}</a>`;
    } else {
      name.textContent = result.businessName;
    }
    header.appendChild(name);
    resultItem.appendChild(header);
    
    // Address if available
    if (result.address) {
      const address = document.createElement('p');
      address.textContent = result.address;
      resultItem.appendChild(address);
    }
    
    // Show timeout message if applicable
    if (result.timedOut) {
      const timeoutMessage = document.createElement('p');
      timeoutMessage.innerHTML = '<strong>Note:</strong> Website timed out (took >15s to load)';
      timeoutMessage.style.color = '#d93025';
      resultItem.appendChild(timeoutMessage);
    } else {
      if (result.contactEmail) {
        const email = document.createElement('p');
        email.innerHTML = '<strong>Contact:</strong> <a href="mailto:' + result.contactEmail + '">' + result.contactEmail + '</a>';
        resultItem.appendChild(email);
      }
      
      if (result.contactPage) {
        const contactPage = document.createElement('p');
        contactPage.innerHTML = '<strong>Contact page:</strong> <a href="' + result.contactPage + '" target="_blank">View</a>';
        resultItem.appendChild(contactPage);
      }
      
      if (result.careerPage) {
        const careerPage = document.createElement('p');
        careerPage.innerHTML = '<strong>Career page:</strong> <a href="' + result.careerPage + '" target="_blank">View</a>';
        resultItem.appendChild(careerPage);
      }
      
      // Display potential job match indicator if available
      if (result.potential_job_match) {
        const potentialJobMatch = document.createElement('p');
        potentialJobMatch.className = 'potential-job-match';
        potentialJobMatch.innerHTML = '<strong>Potential Job Match</strong>';
        potentialJobMatch.style.color = '#4caf50';
        potentialJobMatch.style.fontWeight = 'bold';
        resultItem.appendChild(potentialJobMatch);
      }
      
      // Only display job keywords that aren't search keywords
      if (result.jobKeywords && result.jobKeywords.length > 0) {
        // Filter out any search keywords that might have been added before this change
        // Get the search keywords from localStorage to filter them
        chrome.storage.local.get(['keywords'], function(data) {
          let searchKeywords = [];
          if (data.keywords) {
            searchKeywords = data.keywords.split(',').map(k => k.trim().toLowerCase());
          }
          
          // Filter out search keywords
          const filteredJobKeywords = result.jobKeywords.filter(k => 
            !searchKeywords.includes(k.toLowerCase())
          );
          
          if (filteredJobKeywords.length > 0) {
            const keywords = document.createElement('p');
            keywords.innerHTML = '<strong>Found keywords:</strong> ' + filteredJobKeywords.join(', ');
            resultItem.appendChild(keywords);
          }
        });
      }
      
      // Display job-specific keywords if available (highlighted with higher importance)
      if (result.jobSpecificKeywords && result.jobSpecificKeywords.length > 0) {
        console.log(`[DEBUG] Adding high priority matches for ${result.website}: ${result.jobSpecificKeywords.join(', ')}`);
        const jobSpecificKeywords = document.createElement('p');
        jobSpecificKeywords.className = 'job-specific-keywords';
        jobSpecificKeywords.innerHTML = '<strong>High priority matches:</strong> <span class="highlight">' + 
          result.jobSpecificKeywords.join('</span>, <span class="highlight">') + '</span>';
        resultItem.appendChild(jobSpecificKeywords);
      } else {
        console.log(`[DEBUG] No high priority matches for ${result.website}. jobSpecificKeywords value:`, 
                    result.jobSpecificKeywords === undefined ? 'undefined' : 
                    result.jobSpecificKeywords === null ? 'null' : 
                    Array.isArray(result.jobSpecificKeywords) ? `empty array [${result.jobSpecificKeywords.length}]` : 
                    typeof result.jobSpecificKeywords);
      }
      
      // Display job listings if available
      if (result.jobListings && result.jobListings.length > 0) {
        const jobListingsSection = document.createElement('div');
        jobListingsSection.className = 'job-listings-section';
        
        const jobListingsHeader = document.createElement('p');
        jobListingsHeader.innerHTML = `<strong>Found ${result.jobListings.length} relevant job(s):</strong>`;
        jobListingsSection.appendChild(jobListingsHeader);
        
        const jobListingsList = document.createElement('ul');
        jobListingsList.className = 'job-listings-list';
        
        result.jobListings.forEach(listing => {
          const listingItem = document.createElement('li');
          listingItem.className = 'job-listing-item';
          
          const listingTitle = document.createElement('div');
          listingTitle.className = 'job-listing-title';
          listingTitle.innerHTML = `<strong>${listing.title}</strong>`;
          listingItem.appendChild(listingTitle);
          
          const listingSnippet = document.createElement('div');
          listingSnippet.className = 'job-listing-snippet';
          listingSnippet.textContent = listing.snippet;
          listingItem.appendChild(listingSnippet);
          
          if (listing.keywords && listing.keywords.length > 0) {
            const listingKeywords = document.createElement('div');
            listingKeywords.className = 'job-listing-keywords';
            listingKeywords.innerHTML = `<small>Matched keywords: ${listing.keywords.join(', ')}</small>`;
            listingItem.appendChild(listingKeywords);
          }
          
          jobListingsList.appendChild(listingItem);
        });
        
        jobListingsSection.appendChild(jobListingsList);
        resultItem.appendChild(jobListingsSection);
      }
      
      // Job site links section removed to comply with Google Maps scraping policy
    }
    
    // Create footer section with date and score
    const resultFooter = document.createElement('div');
    resultFooter.className = 'result-footer';
    
    // Create score badge
    const scoreBadge = document.createElement('span');
    scoreBadge.className = 'score-badge-small';
    const score = typeof result.score === 'number' ? result.score : 0;
    
    // Add indicator for potential job match in the score badge
    if (result.potential_job_match) {
      scoreBadge.textContent = `Score: ${score}`;
      scoreBadge.title = "Potential job match found";
    } else {
      scoreBadge.textContent = `Score: ${score}`;
    }
    
    // Set badge color based on score range
    if (score >= 80) {
      scoreBadge.classList.add('high-score');
    } else if (score >= 50) {
      scoreBadge.classList.add('medium-score');
    } else if (score > 0) {
      scoreBadge.classList.add('low-score');
    } else {
      scoreBadge.classList.add('no-score');
    }
    
    // Add score badge and last checked date to footer
    resultFooter.appendChild(scoreBadge);
    
    if (result.lastChecked) {
      const lastChecked = document.createElement('span');
      lastChecked.className = 'last-checked';
      lastChecked.innerHTML = '<small>Last checked: ' + new Date(result.lastChecked).toLocaleString() + '</small>';
      resultFooter.appendChild(lastChecked);
    }
    
    resultItem.appendChild(resultFooter);
    
    container.appendChild(resultItem);
  }
});