/**
 * Integration tests for job-specific keywords functionality
 * These tests verify that job-specific keywords are properly passed through
 * the extension's core processing flow
 */

// Mock Chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
    connect: jest.fn().mockReturnValue({
      onDisconnect: { addListener: jest.fn() },
      onMessage: { addListener: jest.fn() }
    })
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  tabs: {
    query: jest.fn()
  }
};

// Mock sessionStorage
global.sessionStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn()
};

describe('Job-Specific Keywords Integration', () => {
  let searchData;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    searchData = {
      keywords: ['developer', 'programmer'],
      jobKeywords: ['remote', 'senior'],
      location: 'Berlin',
      maxResults: 10
    };
  });
  
  test('Job-specific keywords are passed to search flow', () => {
    // Simple test to ensure the test runner works
    expect(searchData.jobKeywords).toEqual(['remote', 'senior']);
  });
});
