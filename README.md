# Google Maps Jobs Search Extension made with LLM using Copilot Agent and Claude 3.7 Sonnet

A Chrome extension that helps you find job opportunities by searching businesses on Google Maps and analyzing their websites for job listings and contact information.

Available on [Chrome Web Store](https://chromewebstore.google.com/detail/google-maps-job-search-he/nicoepfjkeehhlnioobfdpabjgnebhhb)

## Features

- Search for businesses on Google Maps based on keywords and location
- Extract business website URLs from Google Maps listings
- Scan websites for job-related content in multiple languages
- Find job pages and contact information
- Export results to CSV
- Cache previously visited websites to improve performance

## Installation Instructions

To install and run this extension in Chrome developer mode:

1. **Download or clone this repository**
   - Save it to a location on your computer

2. **Open Chrome Extensions page**
   - Open Chrome and navigate to `chrome://extensions/`
   - Or click Menu (three dots) > More Tools > Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner of the Extensions page

4. **Load the extension**
   - Click the "Load unpacked" button that appears after enabling Developer mode
   - Navigate to the folder where you saved this repository and select it
   - Click "Select Folder" or "Open"

5. **Verify installation**
   - The extension should now appear in your list of extensions
   - You should see the Google Maps Jobs Search icon in your browser toolbar

## Usage

1. Navigate to [Google Maps](https://www.google.com/maps)
2. Click on the extension icon to open the popup
3. Enter your search criteria:
   - Keywords (e.g., "software engineer", "marketing")
   - Location (e.g., "Berlin, Germany")
   - Max Results (default: 20) - limits the number of websites processed
   - Customize Website Keywords (optional) - terms used to identify job opportunities
4. Click "Start Search" to begin
5. The extension will:
   - Search Google Maps for businesses
   - Extract their websites (limited to the Max Results setting)
   - Check each website for job-related content
   - Display results in real-time
6. When the search completes, you can export results to CSV

## Permissions

This extension requires the following permissions:
- Access to Google Maps pages
- Ability to create and manage tabs
- Access to storage (for caching results)

## Disclaimer

This extension is for educational and personal use only. Please respect website terms of service and robots.txt restrictions when using this tool. The creators of this extension are not responsible for any misuse or violations of terms of service that may result from using this tool. Always be mindful of rate limiting and avoid excessive requests to websites.

## Troubleshooting

- If the extension doesn't work, make sure you're on a Google Maps page
- If no results appear, try using different keywords or expanding your search location
- If websites take too long to load, they will be skipped (timeout after 15 seconds)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
