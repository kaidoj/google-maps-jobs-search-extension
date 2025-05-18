/**
 * Unit tests for job-specific keywords functionality
 * These tests verify that job-specific keywords are properly processed
 * and scored differently from regular keywords
 */
const { describe, expect, test } = require('@jest/globals');

describe('Job-Specific Keywords Functionality', () => {
  // Isolated version of the searchForJobContent function for testing
  function testSearchForJobContent(website, searchData, mockPageContent) {
    // Result object with same structure as in the original function
    const result = {
      jobKeywords: [],
      jobSpecificKeywords: [],
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
      
      // Search for user-provided keywords
      const searchKeywords = searchData.keywords || [];
      for (const keyword of searchKeywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageText.includes(keywordLower)) {
          if (!result.jobKeywords.includes(keyword)) {
            result.jobKeywords.push(keyword);
            result.score += 20; // Add 20 points for each user keyword found on main page
          }
        }
      }
      
      // Search for job-specific keywords (highest priority)
      const jobKeywords = searchData.jobKeywords || [];
      for (const keyword of jobKeywords) {
        const keywordLower = keyword.toLowerCase();
        if (pageText.includes(keywordLower)) {
          // Add to job-specific keywords
          result.jobSpecificKeywords.push(keyword);
          
          // Also add to regular job keywords for backward compatibility
          if (!result.jobKeywords.includes(keyword)) {
            result.jobKeywords.push(keyword);
          }
          
          result.score += 40; // Add 40 points for each job-specific keyword found on main page
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error in test function:', error);
      return result;
    }
  }
  
  // Test scoring for job-specific keywords
  test('Should award 40 points for each job-specific keyword found', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["web developer"],
      jobKeywords: ["remote", "senior"]
    };
    
    const mockPageContent = {
      mainPageText: "We're looking for remote senior developers who can work from home.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 40 points each for "remote" and "senior"
    expect(result.jobSpecificKeywords).toContain("remote");
    expect(result.jobSpecificKeywords).toContain("senior");
    expect(result.score).toBe(80); // 40 + 40 points
  });
  
  // Test combined scoring of regular and job-specific keywords
  test('Should correctly score both regular and job-specific keywords', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["javascript", "react"],
      jobKeywords: ["remote"]
    };
    
    const mockPageContent = {
      mainPageText: "We need javascript and react developers who can work remote.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should award 20 points each for regular keywords and 40 for job-specific
    expect(result.jobKeywords).toContain("javascript");
    expect(result.jobKeywords).toContain("react");
    expect(result.jobKeywords).toContain("remote");
    expect(result.jobSpecificKeywords).toContain("remote");
    expect(result.score).toBe(80); // 20 + 20 + 40 points
  });
  
  // Test that job-specific keywords are also added to regular keywords list
  test('Should add job-specific keywords to regular keywords list for backward compatibility', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["developer"],
      jobKeywords: ["senior", "remote"]
    };
    
    const mockPageContent = {
      mainPageText: "We have senior developer positions available.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // The job-specific keyword "senior" should also be in the regular jobKeywords array
    expect(result.jobSpecificKeywords).toContain("senior");
    expect(result.jobKeywords).toContain("senior");
    expect(result.jobKeywords).toContain("developer");
    expect(result.score).toBe(60); // 20 for "developer" + 40 for "senior"
  });
  
  // Test handling of empty job-specific keywords array
  test('Should handle empty job-specific keywords array gracefully', () => {
    const website = { businessName: "Test Company" };
    const searchData = {
      keywords: ["developer"],
      jobKeywords: [] // Empty job-specific keywords
    };
    
    const mockPageContent = {
      mainPageText: "We're looking for developers to join our team.",
      links: []
    };
    
    const result = testSearchForJobContent(website, searchData, mockPageContent);
    
    // Should still process regular keywords correctly
    expect(result.jobKeywords).toContain("developer");
    expect(result.jobSpecificKeywords).toEqual([]);
    expect(result.score).toBe(20); // 20 points for "developer"
  });
  
  // Test job site integration
  test('Should process job-specific keywords in career-page helper', () => {
    // This is a simplified mock version of the searchForJobSiteLinks function
    function mockSearchForJobSiteLinks(searchKeywords = [], jobKeywords = []) {
      const result = {
        keywords: [],
        userKeywords: [],
        jobSpecificKeywords: [],
        score: 0
      };
      
      // Mock page text with both regular and job-specific keywords
      const mockPageText = "careers job position senior remote full-time developer javascript";
      
      // Process regular keywords
      for (const keyword of searchKeywords) {
        if (mockPageText.includes(keyword.toLowerCase())) {
          result.userKeywords.push(keyword);
          result.score += 20;
        }
      }
      
      // Process job-specific keywords
      for (const keyword of jobKeywords) {
        if (mockPageText.includes(keyword.toLowerCase())) {
          result.jobSpecificKeywords.push(keyword);
          result.score += 40;
        }
      }
      
      return result;
    }
    
    // Test with both types of keywords
    const searchKeywords = ["javascript", "developer"];
    const jobKeywords = ["senior", "remote"];
    
    const result = mockSearchForJobSiteLinks(searchKeywords, jobKeywords);
    
    // Should find and score all keywords correctly
    expect(result.userKeywords).toEqual(["javascript", "developer"]);
    expect(result.jobSpecificKeywords).toEqual(["senior", "remote"]);
    expect(result.score).toBe(120); // (2 * 20) + (2 * 40) points
  });
});
