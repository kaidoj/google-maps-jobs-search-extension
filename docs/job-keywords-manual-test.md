# Job-Specific Keywords Feature - Manual Testing Instructions

Use these steps to manually test the job-specific keywords feature in the Google Maps Jobs Search extension.

## Setup

1. Load the extension in Chrome developer mode:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked" and select the extension folder

## Test Case 1: Basic Functionality

1. Open Google Maps (maps.google.com)
2. Click the extension icon to open the popup
3. Enter the following search criteria:
   - Location: "Berlin, Germany"
   - Keywords: "programmer, developer"
   - Job Keywords: "remote, senior"
   - Max Results: 5 (to make the test faster)
4. Click "Start Job Search"
5. Wait for the search to complete

**Expected Results:**
- Search results should include websites that match both regular and job-specific keywords
- Websites that contain "remote" or "senior" should receive higher scoring (40 points per match)
- The job-specific keywords should be displayed with special highlighting in the results

## Test Case 2: CSV Export

1. After completing the search, click "Export to CSV"
2. Open the downloaded CSV file

**Expected Results:**
- The CSV file should contain a "High Priority Keywords" column
- The column should list any job-specific keywords that were found on each website

## Test Case 3: Persistence

1. Enter job-specific keywords in the popup
2. Close the popup and reopen it

**Expected Results:**
- The previously entered job-specific keywords should still be displayed in the input field

## Test Case 4: Scoring Comparison

1. Perform a search with the same regular keywords but no job-specific keywords
2. Note the scoring of results
3. Perform another search with the same regular keywords, but add job-specific keywords that are likely to be found
4. Compare the scoring

**Expected Results:**
- Websites that match job-specific keywords should have significantly higher scores
- The order of results may change based on the higher scoring from job-specific keywords

## Test Case 5: Visual Display

1. Perform a search that includes job-specific keywords
2. Examine the search results display

**Expected Results:**
- Job-specific keywords should be displayed separately from regular keywords
- Job-specific keywords should have a distinct visual style (blue highlight)

## Bug Reporting

If you encounter any issues during testing, please document:
1. The specific test case where the issue occurred
2. The expected vs. actual behavior
3. Any error messages in the browser console (F12 > Console)
4. Screenshots if applicable
