// This fix should be applied to the chrome.runtime.onMessage.addListener function
// in js/content.js to fix the issue where the cancel button doesn't show during search
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'popupOpened') {
    console.log('Popup opened, checking search state');
    
    // Double check if search is in progress and send it to popup
    if (searchInProgress) {
      console.log('Search is in progress, informing popup');
      sendResponse({ inProgress: true });
      
      // Also make sure the session storage flag is set
      try {
        sessionStorage.setItem('gmjs_search_in_progress', 'true');
        sessionStorage.setItem('gmjs_searchData', JSON.stringify(searchData));
      } catch (e) {
        console.error('Error setting search state in session storage:', e);
      }
      
      return true; // Keep the messaging channel open
    }
    
    // Check if search was completed
    const searchCompleted = sessionStorage.getItem('gmjs_searchCompleted') === 'true';
    
    if (searchCompleted) {
      console.log('Search was completed, informing popup');
      sendResponse({ searchCompleted: true });
      return true;
    }
    
    // Default response if no active search
    sendResponse({ inProgress: false, searchCompleted: false });
    return true;
  }
  
  // Add other message handlers here
});
