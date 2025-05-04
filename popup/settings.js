// Settings page JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Get form elements
  const enableCacheCheckbox = document.getElementById('enable-cache');
  const cacheTimeInput = document.getElementById('cache-time');
  const clearCacheButton = document.getElementById('clear-cache');
  const cacheCountElement = document.getElementById('cache-count');
  const cacheStatsContainer = document.getElementById('cache-stats');
  const backButton = document.getElementById('back-button');
  
  // Add back button event listener
  backButton.addEventListener('click', function() {
    // Always set preserveState to true when returning to popup
    // This ensures the popup will restore search results
    window.location.href = 'popup.html?preserveState=true';
  });
  
  // Submit handler for settings form
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  
  // Load settings from storage
  loadSettings();
  
  // Update saved website stats
  updateSavedWebsitesStats();
  
  // Add event listener for clear saved data button
  clearCacheButton.addEventListener('click', function() {
    clearSavedWebsites();
  });
  
  // Load settings from storage
  function loadSettings() {
    chrome.storage.local.get(['enableCache', 'cacheTime'], function(data) {
      if (data.enableCache !== undefined) {
        enableCacheCheckbox.checked = data.enableCache;
      } else {
        // Default to enabled if not set
        enableCacheCheckbox.checked = true;
      }
      
      if (data.cacheTime !== undefined) {
        cacheTimeInput.value = data.cacheTime;
      } else {
        // Default to 30 days if not set
        cacheTimeInput.value = '30';
      }
    });
  }
  
  // Save settings to storage
  function saveSettings(e) {
    if (e) e.preventDefault();
    
    const settings = {
      enableCache: enableCacheCheckbox.checked,
      cacheTime: parseInt(cacheTimeInput.value)
    };
    
    chrome.storage.local.set(settings, function() {
      // Create a status message to show settings were saved
      const statusElement = document.createElement('div');
      statusElement.textContent = 'Settings saved';
      statusElement.className = 'save-status';
      
      // Add to page
      const settingsForm = document.getElementById('settings-form');
      settingsForm.appendChild(statusElement);
      
      // Remove after 2 seconds
      setTimeout(function() {
        statusElement.remove();
      }, 2000);
    });
  }
  
  // Update stats about saved websites
  function updateSavedWebsitesStats() {
    chrome.storage.local.get(null, function(data) {
      // Count cache entries
      let cacheCount = 0;
      let oldestTimestamp = Date.now();
      let newestTimestamp = 0;
      
      for (const key in data) {
        if (key.startsWith('cached_')) {
          cacheCount++;
          
          // Check timestamps
          if (data[key].timestamp) {
            oldestTimestamp = Math.min(oldestTimestamp, data[key].timestamp);
            newestTimestamp = Math.max(newestTimestamp, data[key].timestamp);
          }
        }
      }
      
      // Update count display
      cacheCountElement.textContent = cacheCount;
      
      // If we have cache entries, display the date ranges
      if (cacheCount > 0) {
        cacheStatsContainer.style.display = 'block';
        
        // Add date info
        const oldestDate = new Date(oldestTimestamp).toLocaleDateString();
        const newestDate = new Date(newestTimestamp).toLocaleDateString();
        
        const dateRangeElement = document.getElementById('cache-date-range');
        if (dateRangeElement) {
          dateRangeElement.textContent = `${oldestDate} to ${newestDate}`;
        }
      } else {
        cacheStatsContainer.style.display = 'none';
      }
    });
  }
  
  // Clear saved websites (cache)
  function clearSavedWebsites() {
    if (confirm('Are you sure you want to clear all cached website data?')) {
      // Get all keys first
      chrome.storage.local.get(null, function(data) {
        const keysToRemove = [];
        
        // Find cache keys
        for (const key in data) {
          if (key.startsWith('cached_')) {
            keysToRemove.push(key);
          }
        }
        
        // Remove the cache entries
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, function() {
            // Update stats
            updateSavedWebsitesStats();
            
            // Show confirmation
            const confirmElement = document.createElement('div');
            confirmElement.textContent = `Cleared ${keysToRemove.length} cached websites`;
            confirmElement.className = 'save-status';
            
            // Add to page
            const settingsForm = document.getElementById('settings-form');
            settingsForm.appendChild(confirmElement);
            
            // Remove after 2 seconds
            setTimeout(function() {
              confirmElement.remove();
            }, 2000);
          });
        }
      });
    }
  }
});