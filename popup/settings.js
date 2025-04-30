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
    window.location.href = 'popup.html';
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
    updateSavedWebsitesStats();
  });
  
  // Function to load settings from storage
  function loadSettings() {
    chrome.storage.local.get(['enableCache', 'cacheTime'], function(data) {
      // Set enable save previously visited checkbox (default to true if not set)
      enableCacheCheckbox.checked = data.enableCache !== false;
      
      // Set remember for days input (default to 7 days if not set)
      cacheTimeInput.value = data.cacheTime || 7;
    });
  }
  
  // Function to save settings to storage
  function saveSettings(e) {
    e.preventDefault();
    
    // Get values from form
    const enableCache = enableCacheCheckbox.checked;
    const cacheTime = parseInt(cacheTimeInput.value);
    
    // Save settings to storage
    chrome.storage.local.set({
      enableCache: enableCache,
      cacheTime: cacheTime
    }, function() {
      // Show confirmation message
      const savedMsg = document.createElement('div');
      savedMsg.className = 'saved-message';
      savedMsg.textContent = 'Settings saved!';
      document.body.appendChild(savedMsg);
      
      // Remove message after 2 seconds
      setTimeout(function() {
        document.body.removeChild(savedMsg);
      }, 2000);
    });
  }
  
  // Function to update saved website stats
  function updateSavedWebsitesStats() {
    chrome.storage.local.get(null, function(data) {
      let savedCount = 0;
      
      // Count entries that start with "cached_"
      for (const key in data) {
        if (key.startsWith('cached_')) {
          savedCount++;
        }
      }
      
      // Update count in UI
      cacheCountElement.textContent = savedCount;
      
      // Show stats container if there are saved websites
      if (savedCount > 0) {
        cacheStatsContainer.classList.remove('hidden');
      } else {
        cacheStatsContainer.classList.add('hidden');
      }
    });
  }
  
  // Function to clear all saved website data
  function clearSavedWebsites() {
    chrome.storage.local.get(null, function(data) {
      const keysToRemove = [];
      
      // Find all keys that start with "cached_"
      for (const key in data) {
        if (key.startsWith('cached_')) {
          keysToRemove.push(key);
        }
      }
      
      // Remove all saved website entries
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, function() {
          console.log('Cleared all saved website data');
        });
      }
    });
  }
});