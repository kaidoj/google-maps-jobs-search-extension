# Makefile for Google Maps Jobs Search Chrome extension

# Variables
EXTENSION_NAME = google-maps-jobs-search
VERSION = $(shell grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
RELEASE_DIR = releases/chrome
RELEASE_FILE = $(RELEASE_DIR)/$(EXTENSION_NAME)-$(VERSION).zip

# Files to include in the release
INCLUDES = manifest.json \
           background/ \
           css/ \
           images/ \
           js/ \
           popup/ \
           LICENSE \
           README.md

# Default target
.PHONY: all
all: help

# Help information
.PHONY: help
help:
	@echo "Google Maps Jobs Search Extension Make Commands"
	@echo "----------------------------------------------"
	@echo "build-chrome   : Build the Chrome extension (zip for Chrome Web Store)"
	@echo "clean          : Remove built packages"

# Chrome build
.PHONY: build-chrome
build-chrome:
	@echo "Building Chrome extension v$(VERSION)..."
	@mkdir -p $(RELEASE_DIR)
	@rm -f $(RELEASE_FILE)
	@zip -r $(RELEASE_FILE) $(INCLUDES) -x "*/.*" -x "*/node_modules/*"
	@echo "Chrome package created at $(RELEASE_FILE)"

# Clean builds
.PHONY: clean
clean:
	@echo "Cleaning up release files..."
	@rm -f $(RELEASE_DIR)/*.zip