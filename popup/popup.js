document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const keywordsInput = document.getElementById('keywords');
  const locationInput = document.getElementById('location');
  const websiteKeywordsInput = document.getElementById('website-keywords');
  const maxResultsInput = document.getElementById('max-results');
  const resetWebsiteKeywordsButton = document.getElementById('reset-website-keywords');
  const startSearchButton = document.getElementById('start-search');
  const resultsContainer = document.getElementById('results-container');
  const statusMessage = document.getElementById('status-message');
  const progressBar = document.getElementById('progress-bar');
  const resultsList = document.getElementById('results-list');
  const exportCsvButton = document.getElementById('export-csv');
  
  let allResults = []; // Store all results for CSV export
  
  // Default website keywords that will be used if none are specified
  const DEFAULT_WEBSITE_KEYWORDS = [
    'job', 'jobs', 'career', 'careers', 'work', 'vacancy', 'vacancies',
    'hire', 'hiring', 'apply', 'application', 'position', 'spontaneous',
    'opportunity', 'employment', 'recruitment', 'join us', 'join our team',
  ];
  
  // Connect to the content script to detect popup closure
  const port = chrome.runtime.connect({ name: 'popup' });
  
  // Check if there's a running search when popup opens
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    if (currentTab.url.includes('google.com/maps')) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'popupOpened' }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error checking search status:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.inProgress) {
          // Create a cancel button if a search is in progress
          showCancelSearchOption();
        }
      });
    }
  });
  
  // Function to show cancel search option
  function showCancelSearchOption() {
    // Create a cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel Running Search';
    cancelButton.className = 'secondary-button';
    cancelButton.style.marginTop = '10px';
    cancelButton.style.backgroundColor = '#d93025';
    cancelButton.style.color = 'white';
    
    // Add it before the start search button
    startSearchButton.parentNode.insertBefore(cancelButton, startSearchButton);
    startSearchButton.style.display = 'none'; // Hide the start button
    
    // Add event listener
    cancelButton.addEventListener('click', function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelSearch' }, function(response) {
          if (response && response.status === 'search_cancelled') {
            // Remove the cancel button and show the start button again
            cancelButton.remove();
            startSearchButton.style.display = 'block';
            statusMessage.textContent = 'Previous search cancelled. You can start a new search.';
          }
        });
      });
    });
  }
  
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
      'Found Keywords',
      'Contact Email',
      'Contact Page',
      'Last Checked'
    ];
    
    // Start with headers
    let csvContent = headers.join(',') + '\n';
    
    // Add rows for each result
    results.forEach(result => {
      const row = [
        // Escape fields that might contain commas
        escapeForCsv(result.businessName || ''),
        escapeForCsv(result.address || ''),
        escapeForCsv(result.website || ''),
        escapeForCsv(result.jobKeywords ? result.jobKeywords.join('; ') : ''),
        escapeForCsv(result.contactEmail || ''),
        escapeForCsv(result.contactPage || ''),
        result.lastChecked ? new Date(result.lastChecked).toLocaleString() : ''
      ];
      
      csvContent += row.join(',') + '\n';
    });
    
    return csvContent;
  }
  
  // Helper function to escape CSV fields
  function escapeForCsv(field) {
    // If the field contains commas, quotes, or newlines, wrap it in quotes
    if (/[",\n\r]/.test(field)) {
      // Double any existing quotes
      field = field.replace(/"/g, '""');
      // Wrap the field in quotes
      return `"${field}"`;
    }
    return field;
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
    
    // Disable the search button to prevent multiple searches
    startSearchButton.disabled = true;
    
    // Get current tab to check if we're on Google Maps
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      
      // Check if we're on Google Maps
      if (currentTab.url.includes('google.com/maps')) {
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
                startSearchButton.disabled = false;
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
                        startSearchButton.disabled = false;
                        return;
                      }
                      
                      console.log("Search response received:", searchResponse);
                      
                      // Check response status
                      if (searchResponse && searchResponse.status === 'started') {
                        statusMessage.textContent = 'Search started on Google Maps...';
                      } else if (searchResponse && searchResponse.status === 'error') {
                        console.error('Search error:', searchResponse.error);
                        statusMessage.textContent = `Error starting search: ${searchResponse.error}`;
                        startSearchButton.disabled = false;
                      } else if (searchResponse && searchResponse.status === 'busy') {
                        statusMessage.textContent = 'A search is already in progress.';
                        // Keep button disabled as another search is running
                      } else {
                        console.error('Invalid search response:', searchResponse);
                        statusMessage.textContent = 'Failed to start search. Please try again.';
                        startSearchButton.disabled = false;
                      }
                    }
                  );
                }, 3000); // Increased wait time to 3 seconds
              } else {
                // Reset failed or invalid response
                console.error('Failed to reset Google Maps:', response);
                statusMessage.textContent = 'Error: Failed to reset Google Maps. Please refresh the page and try again.';
                startSearchButton.disabled = false;
              }
            }
          );
        } catch (err) {
          console.error('Exception during reset:', err);
          statusMessage.textContent = 'Error contacting Google Maps. Please refresh the page and try again.';
          startSearchButton.disabled = false;
        }
      } else {
        // Not on Google Maps, show error and open Maps
        statusMessage.textContent = 'Please navigate to Google Maps first';
        startSearchButton.disabled = false;
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
      // Add result to internal array for CSV export
      allResults.push(message.result);
      
      // Add result to the UI
      addResultToList(message.result);
      
      // Enable export button when we have results
      if (allResults.length > 0) {
        exportCsvButton.disabled = false;
      }
    } else if (message.action === 'searchComplete') {
      statusMessage.textContent = 'Search completed!';
      progressBar.style.width = '100%';
      
      // Re-enable the search button when search is complete
      startSearchButton.disabled = false;
    }
    
    sendResponse({received: true});
    return true; // Keep the messaging channel open for async responses
  });
  
  // Function to add a result to the results list
  function addResultToList(result) {
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    
    const title = document.createElement('h3');
    title.textContent = result.businessName;
    resultItem.appendChild(title);
    
    if (result.address) {
      const address = document.createElement('p');
      address.textContent = result.address;
      resultItem.appendChild(address);
    }
    
    if (result.website) {
      const website = document.createElement('p');
      const websiteLink = document.createElement('a');
      websiteLink.href = result.website;
      websiteLink.textContent = result.website;
      websiteLink.target = '_blank';
      website.appendChild(websiteLink);
      resultItem.appendChild(website);
    }
    
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