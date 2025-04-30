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
  
  // Connect to the content script to detect popup closure
  const port = chrome.runtime.connect({ name: 'popup' });
  
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
      if (currentTab.url.includes('google.com/maps')) {
        chrome.tabs.sendMessage(currentTab.id, { action: 'popupOpened' }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error checking search status:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.inProgress) {
            // If search is in progress, enable cancel button and disable start button
            updateSearchButtonStates(true);
            
            // Restore search state UI
            restoreSearchState();
          } else {
            // If no search is in progress, check if we have a saved state from previous navigation
            checkForSavedSearchState();
          }
        });
      }
    });
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
      
      chrome.storage.session.set({ 'searchState': searchState });
    }
  }
  
  // Function to check if we have a saved search state
  function checkForSavedSearchState() {
    chrome.storage.session.get(['searchState'], function(data) {
      if (data.searchState) {
        restoreSearchState(data.searchState);
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
      
      // Update button states based on search status
      const isSearchCompleted = statusMessage.textContent === 'Search completed!' || 
                               statusMessage.textContent.includes('cancelled');
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
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelSearch' }, function(response) {
        if (response && response.status === 'search_cancelled') {
          // Update button states
          updateSearchButtonStates(false);
          statusMessage.textContent = 'Search cancelled. You can start a new search.';
          
          // Clear the saved search state from session storage to prevent it from reappearing
          chrome.storage.session.remove(['searchState'], function() {
            console.log('Search state cleared from session storage after cancellation');
          });
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
    
    // Add result rows
    results.forEach(result => {
      const row = [
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
    
    // Business name with website link
    const name = document.createElement('h3');
    if (result.website) {
      name.innerHTML = `<a href="${result.website}" target="_blank">${result.businessName}</a>`;
    } else {
      name.textContent = result.businessName;
    }
    resultItem.appendChild(name);
    
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
    }
    
    if (result.lastChecked) {
      const lastChecked = document.createElement('p');
      lastChecked.className = 'last-checked';
      lastChecked.innerHTML = '<small>Last checked: ' + new Date(result.lastChecked).toLocaleString() + '</small>';
      resultItem.appendChild(lastChecked);
    }
    
    resultsList.appendChild(resultItem);
  }
});