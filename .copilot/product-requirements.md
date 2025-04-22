
### Chrome Extension Requirements

1. Create a Chrome Extension.
2. The extension should work specifically on Google Maps pages.
3. Ask the user for the following inputs:
   - Keywords (e.g., field, industry or company they are looking for)
   - City or location
4. Perform a Google Maps search using the user's input. First search for location and then search for "Keywords in location"
5. Collect all the matching business or organization listings.
6. For each match, visit the website (if available) and:
   - Search for job-related pages (e.g., "Jobs", "Careers", "Spontaneous Applications", etc.)
   - Use the preferred language(s) to translate and search for relevant keywords
7. If a match is found:
   - Return the contact email (if available)
   - Return company name
   - Return the URL of the job page and then also go to that page and match keywords like jobs, careers, spontaneus, etc
8. Timeout if the website takes more than 15 seconds to load. Move on to the next.
9. Cache visited websites and their results to avoid redundant visits.
10. Do not close google maps search sidebar on each result
11. Download a random icon from the internet and use it as the extension icon.
12. Add export results to CSV button, etc.
13. Make sure we don't get blocked by Google by making the usage more human like but a bit more faster then normal.
14. Stop search when the popup closes.
15. Disable search button when search is already running.
16. Make sure the google maps page is not refresh when navigating between businesses on google maps
17. Reset google maps state when new search starts.
18. Follow best practices for security like XSS protection, etc.
19. Create all required extension files for me (manifest, background, content scripts, etc.).
20. Add readme how to run this in chrome with extension dev mode.
21. Add licence MIT.
