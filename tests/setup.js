// Mock Chrome API using jest-chrome
const chrome = require('jest-chrome');
const { mockTabs, mockRuntime } = require('./mocks/chrome-api');

// Create storage mock
const storageMock = {
  local: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn()
  },
  session: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn()
  }
};

// Make chrome available globally
global.chrome = {
  ...chrome,
  tabs: mockTabs,
  runtime: mockRuntime,
  storage: storageMock
};

// Create a mock document object if needed
if (typeof document === 'undefined') {
  global.document = {
    addEventListener: jest.fn(),
    createElement: jest.fn(() => ({
      className: '',
      textContent: '',
      appendChild: jest.fn(),
      addEventListener: jest.fn(),
    })),
    body: {
      appendChild: jest.fn(),
      removeChild: jest.fn(),
    },
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
  };
}

// Add any other global mocks needed for tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

// Mock window properties/methods that aren't available in JSDOM
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'location', {
    value: {
      href: 'https://www.google.com/maps/',
      origin: 'https://www.google.com',
    },
    writable: true,
  });
}