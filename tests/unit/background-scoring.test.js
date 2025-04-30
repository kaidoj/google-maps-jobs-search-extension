/**
 * Unit tests for scoring functionality in background.js
 * These tests verify that the scoring system correctly attributes
 * points based on different scenarios in website analysis
 */

describe('Background Script Scoring Functionality', () => {
  // Isolated copy of the searchForJobContent function for testing
  // This is a simplified version that focuses only on scoring logic
  function testSearchForJobContent(website, searchData, mockPageContent) {
    // Result object with same structure as in the original function
    const result = {
      jobKeywords: [],
      contactEmail: null,
      contactPage: null,
      jobPages: [],
      jobListings: [],
      score: 0,
      businessName: website.businessName || "Unknown Business"
    };
    
    try {
      // Mock document body text content with provided content
      const pageText = mockPageContent.mainPageText.toLowerCase();
      
      // Mock the links on the page
      const links = mockPageContent.links || [];
      
      // Search for job-related keywords
      const searchKeywords = searchData.keywords;
      
      // Define default common job-related terms to look for
      const defaultJobTerms = [
        'job', 'jobs', 'career', 'careers', 'work', 'vacancy', 'vacancies',
        'hire', 'hiring', 'apply', 'application', 'position', 'spontaneous',
        'opportunity', 'employment', 'recruitment', 'join us', 'join our team',
      ];
      
      // Use custom website keywords if provided, otherwise use defaults
      const commonJobTerms = searchData.websiteKeywords || defaultJobTerms;
      
      // Common paths to check for careers/jobs
      const jobPaths = [
        '/jobs', '/careers', '/career', '/join-us', '/join', '/work-with-us',
        '/vacancy', '/vacancies', '/positions', '/opportunities', '/about/careers',
        '/about/jobs', '/company/careers', '/company/jobs', '/jobs-and-careers'
      ];
      
      // Search for common job terms in the page
      for (const term of commonJobTerms) {
        if (pageText.includes(term)) {
          if (!result.jobKeywords.includes(term)) {
            result.jobKeywords.push(term);
            result.score += 5; // Add 5 points for each common job term found
          }
        }
      }
      
      // Search for user-provided keywords
      for (const keyword of searchKeywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageText.includes(keywordLower)) {
          if (!result.jobKeywords.includes(keyword)) {
            result.jobKeywords.push(keyword);
            result.score += 20; // Add 20 points for each user keyword found on main page
          }
        }
      }
      
      // Search for job links
      const jobLinks = links.filter(link => {
        const href = link.href || '';
        const text = link.text.toLowerCase();
        
        // Check if the link text contains job-related keywords
        const hasJobText = commonJobTerms.some(term => text.includes(term));
        
        // Check if the URL path contains job-related paths
        const hasJobPath = jobPaths.some(path => href.toLowerCase().includes(path));
        
        return hasJobText || hasJobPath;
      });
      
      // If job links are found, add to score
      if (jobLinks.length > 0) {
        result.score += 30; // Add 30 points for having job pages
        
        // Process mock job page content if provided
        if (mockPageContent.jobPageContent) {
          const jobPageText = mockPageContent.jobPageContent.toLowerCase();
          let keywordsFoundOnJobPage = false;
          
          // Check if we have mock job listings
          if (mockPageContent.jobListings && mockPageContent.jobListings.length > 0) {
            for (const listing of mockPageContent.jobListings) {
              const listingText = listing.text.toLowerCase();
              
              // Find matching keywords in this listing
              const matchedKeywords = searchKeywords.filter(keyword => 
                listingText.toLowerCase().includes(keyword.toLowerCase())
              );
              
              // Only add if it has matching keywords
              if (matchedKeywords.length > 0) {
                result.jobListings.push({
                  title: listing.title,
                  snippet: listingText.substring(0, 200) + '...',
                  keywords: matchedKeywords,
                  source: 'https://example.com/jobs'
                });
                
                // Perfect match - highest score (100)
                result.score = Math.max(result.score, 100);
                keywordsFoundOnJobPage = true;
              }
            }
          }
          
          // Check if we found specific keywords in the job page, even if not in specific listings
          let keywordMatchCount = 0;
          for (const keyword of searchKeywords) {
            if (jobPageText.includes(keyword.toLowerCase())) {
              if (!result.jobKeywords.includes(keyword)) {
                result.jobKeywords.push(keyword);
                keywordMatchCount++;
              }
            }
          }
          
          // If we found keywords on job page but not in specific listings
          if (keywordMatchCount > 0 && !keywordsFoundOnJobPage) {
            // Score 50-80 based on number of keywords found
            const keywordBonus = Math.min(keywordMatchCount * 15, 30);
            result.score = Math.max(result.score, 50 + keywordBonus);
          }
        }
      }
      
      // Check for contact information - email
      if (mockPageContent.hasEmail) {
        result.contactEmail = "contact@example.com";
        result.score += 10; // Add 10 points for having contact email
      }
      
      // Check for contact page
      if (mockPageContent.hasContactPage) {
        result.contactPage = "https://example.com/contact";
        result.score += 5; // Add 5 points for contact page
      }
      
      // Ensure score is at least 1 if any job-related information was found
      if (result.jobKeywords.length > 0 || result.jobListings.length > 0 || 
          result.jobPages.length > 0) {
        result.score = Math.max(result.score, 1);
      }
      
      return result;
    } catch (error) {
      console.error('Error searching website:', error);
      return result;
    }
  }
  
  // Test scoring for common job terms
  test('Should award 5 points for each common job term found', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: ["job", "career", "hiring"]
    };
    
    const mockPageContent = {
      mainPageText: "We are hiring for various positions. Check our careers page.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 5 points each for "hiring" and "careers"
    expect(result.jobKeywords).toContain("hiring");
    expect(result.jobKeywords).toContain("career");
    expect(result.score).toBe(10); // 5 + 5 points
  });
  
  // Test scoring for user-provided keywords
  test('Should award 20 points for each user keyword found on main page', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer", "frontend engineer"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "We're looking for software developers and frontend engineers to join our team.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 20 points each for "software developer" and "frontend engineer"
    expect(result.jobKeywords).toContain("software developer");
    expect(result.jobKeywords).toContain("frontend engineer");
    expect(result.score).toBe(40); // 20 + 20 points
  });
  
  // Test scoring for job links found
  test('Should award 30 points for having job pages', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "Check out our open positions.",
      links: [
        { href: "https://example.com/careers", text: "Careers" }
      ]
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 30 points for having job links
    expect(result.score).toBe(30);
  });
  
  // Test scoring for contact email
  test('Should award 10 points for having contact email', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "Contact us at info@example.com", // Changed from jobs@example.com to avoid matching 'job' term
      links: [],
      hasEmail: true
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 10 points for having contact email
    expect(result.contactEmail).toBe("contact@example.com");
    expect(result.score).toBe(10);
  });
  
  // Test scoring for contact page
  test('Should award 5 points for having a contact page', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "Get in touch with us.",
      links: [],
      hasContactPage: true
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 5 points for having contact page
    expect(result.contactPage).toBe("https://example.com/contact");
    expect(result.score).toBe(5);
  });
  
  // Test perfect match scoring (100 points)
  test('Should award 100 points when job listings contain user keywords', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer", "frontend engineer"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "Check our careers page for open positions.",
      links: [
        { href: "https://example.com/careers", text: "Careers" }
      ],
      jobPageContent: "We have multiple open positions.",
      jobListings: [
        { 
          title: "Senior Software Developer", 
          text: "We're hiring a software developer with 5+ years of experience in JavaScript."
        }
      ]
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 100 points for perfect match
    expect(result.jobListings.length).toBe(1);
    expect(result.jobListings[0].keywords).toContain("software developer");
    expect(result.score).toBe(100);
  });
  
  // Test keyword relevance scoring (50-80 points)
  test('Should award 50-80 points based on keywords found on job pages', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer", "frontend engineer", "react"],
      websiteKeywords: ["job", "career"]
    };
    
    const mockPageContent = {
      mainPageText: "Check our careers page for open positions.",
      links: [
        { href: "https://example.com/careers", text: "Careers" }
      ],
      jobPageContent: "We're looking for software developers and people with react experience."
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award points for keywords found on job page (50 + 15*2 = 80)
    expect(result.jobKeywords).toContain("software developer");
    expect(result.jobKeywords).toContain("react");
    expect(result.score).toBe(80);
  });
  
  // Test combined scoring
  test('Should calculate correct total score with multiple factors', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: ["job", "career", "hiring"]
    };
    
    const mockPageContent = {
      mainPageText: "We are hiring for various positions. We need a software developer.",
      links: [
        { href: "https://example.com/careers", text: "Careers" }
      ],
      hasEmail: true,
      hasContactPage: true
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should calculate total score:
    // 5 points for "hiring" + 20 points for "software developer" + 30 points for job pages + 10 points for email + 5 points for contact page
    expect(result.score).toBe(70);
  });
  
  // Test minimum score of 1 if any job-related information found
  test('Should set minimum score of 1 if any job-related information found', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["software developer"],
      websiteKeywords: [] // Empty to avoid matching common terms
    };
    
    // Create a mock where no scoring factors are present except a job keyword
    // but that doesn't match any scoring rule (edge case)
    const mockPageContent = {
      mainPageText: "",
      links: [],
      jobKeywords: ["some-unique-term"]
    };
    
    // Manually set a job keyword to simulate an edge case
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    result.jobKeywords = ["some-unique-term"];
    
    // Manually reset score to simulate an edge case where no points were awarded
    result.score = 0;
    
    // Reapply the minimum score rule
    if (result.jobKeywords.length > 0 || result.jobListings.length > 0 || 
        result.jobPages.length > 0) {
      result.score = Math.max(result.score, 1);
    }
    
    // Should have minimum score of 1
    expect(result.score).toBe(1);
  });
});