# Makefile for Hidden Job Search Helper Chrome extension

# Variables
EXTENSION_NAME = google-maps-jobs-search
VERSION = $(shell grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
RELEASE_DIR = releases/chrome
RELEASE_FILE = $(RELEASE_DIR)/$(EXTENSION_NAME)-$(VERSION).zip

# Default target
.PHONY: all
all: help

# Help information
.PHONY: help
help:
	@echo "Hidden Job Search Helper Extension Make Commands"
	@echo "----------------------------------------------"
	@echo "build-chrome   : Build the Chrome extension (zip for Chrome Web Store)"
	@echo "clean          : Remove built packages"
	@echo "test           : Run tests"

# Chrome build - will only proceed if tests pass
.PHONY: build-chrome
build-chrome: test
	@echo "Building Chrome extension v$(VERSION)..."
	@mkdir -p $(RELEASE_DIR)
	@npm run build:chrome
	@echo "Chrome package created at $(RELEASE_FILE)"

# Run tests
.PHONY: test
test:
	@echo "Running Tests..."
	@npm test || (echo "Tests failed! Aborting build." && exit 1)
	@echo "Tests passed successfully!"

# Clean builds
.PHONY: clean
clean:
	@echo "Cleaning up release files..."
	@rm -f $(RELEASE_DIR)/*.zip