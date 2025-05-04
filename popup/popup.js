document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const keywordsInput = document.getElementById('keywords');
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
  
  // Connect to the background script to detect popup closure
  const port = chrome.runtime.connect({ name: 'popup' });
  
  // Notify the background script that the popup is open
  chrome.runtime.sendMessage({ action: 'popupOpened' });
  
  // If we're returning from settings, prioritize restoring the session search state
  if (preserveState) {
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
              fetchResultsFromBackground();
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
      } else {
        // Not on Google Maps, check if we have saved results
        fetchResultsFromBackground();
      }
    });
  }
  
  // Function to fetch search results from background script
  function fetchResultsFromBackground() {
    chrome.runtime.sendMessage({ action: 'getSearchResults' }, function(response) {
      if (chrome.runtime.lastError) {
        console.error('Error fetching search results:', chrome.runtime.lastError);
        // Try local popup state instead
        checkForPopupResults();
        return;
      }
      
      if (response) {
        console.log('Retrieved search state from background:', response);
        
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
                searchCompleted: sessionStorage.getItem('gmjs_searchCompleted')
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
            const isSearchCompleted = results[0].result.searchCompleted === 'true';
            
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
    chrome.storage.local.get(['popupResults', 'popupStatus', 'popupProgress'], function(data) {
      if (data.popupResults && data.popupResults.length > 0) {
        console.log('Retrieved popup-specific saved results:', data);
        
        // Show the results container
        resultsContainer.classList.remove('hidden');
        
        // Set status and progress if not already set by session storage
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
        
        // Update button states based on status text - expanded check for completed status
        const isSearchCompleted = 
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
    });
  }
  
  // Function to display results from background script
  function displayBackgroundResults(response) {
    // Show the results container
    resultsContainer.classList.remove('hidden');
    
    let isProcessing = false; // Flag to track if search is still in progress
    
    // Handle different search statuses
    if (response.status === 'complete') {
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
    if (response.processingInProgress === true) {
      isProcessing = true;
      console.log('Background indicates search is still in progress');
    }
    
    // Update button states based on processing status
    updateSearchButtonStates(isProcessing);
    
    // Clear any existing results
    resultsList.innerHTML = '';
    
    // Combine results from both completed results and in-progress items in the queue
    allResults = [...(response.results || [])];
    
    // Check if there are any items in the processing queue that should be displayed
    if (response.websiteProcessingQueue && response.websiteProcessingQueue.length > 0) {
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
    
    // Display each result
    allResults.forEach(result => {
      addResultToList(result);
    });
    
    // Enable export button if we have results
    exportCsvButton.disabled = allResults.length === 0;
    
    // When we have results in the background, also save them to popup-specific storage
    // This ensures we have a fallback copy
    if (allResults.length > 0) {
      chrome.storage.local.set({
        'popupResults': allResults,
        'popupStatus': statusMessage.textContent,
        'popupProgress': progressBar.style.width
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
    saveSearchState();
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
  
  // Load saved settings
  chrome.storage.local.get(['keywords', 'location', 'websiteKeywords', 'maxResults'], function(data) {
    if (data.keywords) keywordsInput.value = data.keywords;
    if (data.location) locationInput.value = data.location;
    if (data.maxResults) maxResultsInput.value = data.maxResults;
    if (data.websiteKeywords) {
      websiteKeywordsInput.value = data.websiteKeywords;
    } else {
      // Set default website keywords if none are saved
      websiteKeywordsInput.value = DEFAULT_WEBSITE_KEYWORDS.join(', ');
      // Save the defaults
      saveWebsiteKeywords();
    }
  });
  
  // Save settings when inputs change
  function saveSettings() {
    chrome.storage.local.set({
      keywords: keywordsInput.value,
      location: locationInput.value,
      maxResults: maxResultsInput.value
    });
  }
  
  // Save website keywords separately
  function saveWebsiteKeywords() {
    chrome.storage.local.set({
      websiteKeywords: websiteKeywordsInput.value
    });
  }
  
  keywordsInput.addEventListener('change', saveSettings);
  locationInput.addEventListener('change', saveSettings);
  websiteKeywordsInput.addEventListener('change', saveWebsiteKeywords);
  
  // Reset website keywords to defaults
  resetWebsiteKeywordsButton.addEventListener('click', function() {
    websiteKeywordsInput.value = DEFAULT_WEBSITE_KEYWORDS.join(', ');
    saveWebsiteKeywords();
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
      'Contact Email',
      'Contact Page',
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
    
    // Add result rows
    sortedResults.forEach(result => {
      const row = [
        escapeForCsv(result.score !== undefined ? result.score : '0'),
        escapeForCsv(result.businessName || ''),
        escapeForCsv(result.address || ''),
        escapeForCsv(result.website || ''),
        escapeForCsv(result.jobKeywords ? result.jobKeywords.join('; ') : ''),
        escapeForCsv(result.contactEmail || ''),
        escapeForCsv(result.contactPage || ''),
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
    
    const stringValue = String(field);
    
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
    const keywords = keywordsInput.value.trim();
    if (!keywords) {
      alert('Please enter at least one keyword');
      return;
    }
    
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
                    
                  // Set search data
                  const searchData = {
                    keywords: keywords.split(',').map(k => k.trim()),
                    location: locationInput.value.trim(),
                    websiteKeywords: websiteKeywords,
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
      
      // Re-enable the search button when search is complete
      updateSearchButtonStates(false);
    } else if (message.action === 'searchCancelled') {
      statusMessage.textContent = 'Search was cancelled';
      
      // Re-enable the search button when search is cancelled
      updateSearchButtonStates(false);
    }
    
    sendResponse({received: true});
    return true; // Keep the messaging channel open for async responses
  });
  
  // Function to add a result to the results list
  function addResultToList(result) {
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
      } else if (result.contactPage) {
        const contactPage = document.createElement('p');
        contactPage.innerHTML = '<strong>Contact page:</strong> <a href="' + result.contactPage + '" target="_blank">View</a>';
        resultItem.appendChild(contactPage);
      }
      
      if (result.jobKeywords && result.jobKeywords.length > 0) {
        const keywords = document.createElement('p');
        keywords.innerHTML = '<strong>Found keywords:</strong> ' + result.jobKeywords.join(', ');
        resultItem.appendChild(keywords);
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
    }
    
    // Create footer section with date and score
    const resultFooter = document.createElement('div');
    resultFooter.className = 'result-footer';
    
    // Create score badge
    const scoreBadge = document.createElement('span');
    scoreBadge.className = 'score-badge-small';
    const score = typeof result.score === 'number' ? result.score : 0;
    scoreBadge.textContent = `Score: ${score}`;
    
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
    
    resultsList.appendChild(resultItem);
  }
});