// Helper functions for background processing

// Function to be injected into career page tabs to search for job site links
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
